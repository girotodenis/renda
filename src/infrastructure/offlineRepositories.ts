import type { CrudRepository, Repository, RepositoryContext } from '@/domain/repositories/ports'
import { readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import { enqueue, isOnline } from '@/infrastructure/outbox'
import type { MutationDraft } from '@/infrastructure/outbox'

/**
 * Decorador offline dos repositórios (Fase 1 do plano PWA).
 *
 * Envolve um repositório real (`Repository`/`CrudRepository`) para que toda
 * escrita funcione sem rede:
 *
 * - **Offline** (`navigator.onLine === false`): aplica a mutação no cache local
 *   de forma **otimista** (a UI reflete a mudança imediatamente) e a enfileira
 *   no outbox — sem tocar na API.
 * - **Online**: tenta a escrita direta; se ela falhar por **rede/quota**
 *   (`SheetsApiError` com `status` 0 ou 429), cai para o mesmo caminho offline.
 * - **Modo local** (sem Google): o outbox é irrelevante — a "planilha" já é o
 *   banco local, então as escritas vão direto ao repositório, sem fila.
 *
 * Leitura (`list`/`readCache`/`refresh`) e `invalidateCache` apenas delegam —
 * a leitura cache-first continua igual. Os contratos de domínio
 * (`Repository<T>`/`CrudRepository<T>`) são preservados integralmente.
 *
 * O decorador **não** importa `repositories.ts` (evita ciclo): ele é genérico e
 * recebe o repositório já construído.
 */

/** Opções do decorador offline. */
export interface OfflineRepositoryOptions<T> {
  /**
   * Extrai o ID estável de uma entidade. Necessário para aplicar
   * `update`/`remove` otimistas no cache por ID. Padrão: `entity.id`.
   */
  idOf?: (entity: T) => string
  /**
   * Quando `false`, as escritas vão **direto** ao repositório real, mesmo
   * offline — sem atualização otimista e sem outbox. Usado na aba derivada
   * `Consolidado` (recalculada pela sincronização da Fase 2).
   */
  outboxEnabled?: boolean
}

/**
 * `true` quando o erro de escrita é recuperável por falta de rede/quota
 * (`SheetsApiError.status === 0` ou `429`). Outros erros (ex.: 401/403/500)
 * devem ser propagados ao chamador.
 */
function isOfflineWriteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const status = (error as { status?: unknown }).status
  return status === 0 || status === 429
}

function defaultIdOf<T>(entity: T): string {
  return String((entity as { id?: unknown }).id ?? '')
}

export function withOfflineOutbox<T>(
  repo: CrudRepository<T>,
  options?: OfflineRepositoryOptions<T>,
): CrudRepository<T>
export function withOfflineOutbox<T>(
  repo: Repository<T>,
  options?: OfflineRepositoryOptions<T>,
): Repository<T>
export function withOfflineOutbox<T>(
  repo: Repository<T>,
  options: OfflineRepositoryOptions<T> = {},
): Repository<T> {
  const idOf = options.idOf ?? defaultIdOf<T>
  const outboxEnabled = options.outboxEnabled ?? true

  /** Aplica a mutação ao cache da aba (otimista) e a enfileira no outbox. */
  function applyOptimistic(context: RepositoryContext, draft: MutationDraft): void {
    const { spreadsheetId } = context
    const sheetName = repo.sheetName
    const current = readSheetCache<T>(spreadsheetId, sheetName)?.rows ?? []

    switch (draft.kind) {
      case 'append':
        writeSheetCache(spreadsheetId, sheetName, [...current, draft.entity as T])
        break
      case 'replaceAll':
        writeSheetCache(spreadsheetId, sheetName, (draft.entities as readonly T[] | undefined) ?? [])
        break
      case 'update': {
        const entity = draft.entity as T
        const id = draft.entityId ?? idOf(entity)
        writeSheetCache(
          spreadsheetId,
          sheetName,
          current.map((row) => (idOf(row) === id ? entity : row)),
        )
        break
      }
      case 'remove': {
        const id = draft.entityId ?? ''
        writeSheetCache(
          spreadsheetId,
          sheetName,
          current.filter((row) => idOf(row) !== id),
        )
        break
      }
    }

    enqueue(draft)
  }

  /**
   * Executa a escrita direta quando online (caindo para o outbox em falha de
   * rede/quota) ou aplica a mutação otimista quando offline. Com o outbox
   * desabilitado, apenas delega ao repositório real.
   */
  function writeWithOutbox<TResult>(
    context: RepositoryContext,
    draft: MutationDraft,
    direct: () => Promise<TResult>,
    optimisticResult: () => TResult,
  ): Promise<TResult> {
    if (!outboxEnabled || isModoLocal()) return direct()

    return (async () => {
      if (isOnline()) {
        try {
          return await direct()
        } catch (error) {
          if (!isOfflineWriteError(error)) throw error
        }
      }
      applyOptimistic(context, draft)
      return optimisticResult()
    })()
  }

  const wrapped: Repository<T> = {
    sheetName: repo.sheetName,
    newId: () => repo.newId(),
    list: (context, listOptions) => repo.list(context, listOptions),
    readCache: (spreadsheetId) => repo.readCache(spreadsheetId),
    refresh: (context) => repo.refresh(context),
    invalidateCache: (spreadsheetId) => repo.invalidateCache(spreadsheetId),
    append: (context, entity) =>
      writeWithOutbox(
        context,
        { sheet: repo.sheetName, kind: 'append', entity },
        () => repo.append(context, entity),
        () => entity,
      ),
    replaceAll: (context, entities) =>
      writeWithOutbox(
        context,
        { sheet: repo.sheetName, kind: 'replaceAll', entities },
        () => repo.replaceAll(context, entities),
        () => undefined,
      ),
  }

  const crud = repo as CrudRepository<T>
  if (typeof crud.update !== 'function' || typeof crud.remove !== 'function') {
    return wrapped
  }

  const wrappedCrud: CrudRepository<T> = {
    ...wrapped,
    update: (context, entity) =>
      writeWithOutbox(
        context,
        { sheet: repo.sheetName, kind: 'update', entity, entityId: idOf(entity) },
        () => crud.update(context, entity),
        () => entity,
      ),
    remove: (context, id) =>
      writeWithOutbox(
        context,
        { sheet: repo.sheetName, kind: 'remove', entityId: id },
        () => crud.remove(context, id),
        () => undefined,
      ),
  }

  return wrappedCrud
}
