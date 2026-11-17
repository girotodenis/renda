import type { CrudRepository, Repository, RepositoryContext } from '@/domain/repositories/ports'
import type { SheetName } from '@/domain/sheetsSchema'
import { readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import { enqueue, list as listMutations } from '@/infrastructure/outbox'
import type { MutationDraft } from '@/infrastructure/outbox'

/**
 * Decorador local-first dos repositórios (fila de escrita no padrão outbox).
 *
 * Toda escrita de aba é **local primeiro**: a mutação é aplicada no cache (a UI
 * reflete a alteração na hora) e enfileirada no outbox. A gravação na origem
 * (Drive/Sheets) acontece depois, de forma assíncrona e em lote, pelo flush do
 * `sync.ts` — que reaproveita `executarEmLote` e custa **um** upload para N
 * mutações.
 *
 * Regras:
 *
 * - **Modo local** (sem Google): o outbox é irrelevante — a "planilha" já é o
 *   banco do navegador, então as escritas vão direto ao repositório, sem fila.
 * - **Outbox desabilitado** (`outboxEnabled: false`): usado na aba derivada
 *   `Consolidado`, recalculada pelo flush.
 * - **Escrita imediata** (`comEscritaImediata`): fluxos administrativos que
 *   precisam reler/conferir a origem (importação, consolidação, criptografia)
 *   gravam direto, sem passar pela fila.
 *
 * Leitura (`list`/`readCache`/`refresh`) continua cache-first; quando a leitura
 * vem da origem, as mutações ainda pendentes são **reaplicadas** sobre o
 * resultado (`aplicarPendenciasNoCache`) — senão o que o usuário acabou de
 * salvar "desapareceria" da tela até o próximo flush.
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
   * Quando `false`, as escritas vão **direto** ao repositório real, sem
   * atualização otimista e sem outbox. Usado na aba derivada `Consolidado`
   * (recalculada pelo flush da sincronização).
   */
  outboxEnabled?: boolean
}

/** Opções de `aplicarPendenciasNoCache`. */
export interface OpcoesAplicarPendencias {
  /**
   * IDs de mutações que **não** devem ser reaplicadas — as que o flush acabou
   * de gravar na origem e que já estão no resultado recém-lido.
   */
  excluirIds?: ReadonlySet<string>
}

/**
 * Profundidade do modo "escrita imediata". Enquanto for > 0, as escritas vão
 * direto ao repositório real (sem outbox) — o comportamento anterior ao
 * local-first, exigido pelos fluxos administrativos.
 */
let escritaImediataDepth = 0

/** `true` quando as escritas devem ir direto à origem (sem outbox). */
export function isEscritaImediata(): boolean {
  return escritaImediataDepth > 0
}

/**
 * Executa `fn` com as escritas indo direto à origem (sem outbox).
 *
 * Usado por fluxos que **relêem a origem** para conferir invariantes antes de
 * gravar (importação, consolidação, criptografia): neles a fila precisa estar
 * vazia e a escrita não pode ser adiada.
 */
export async function comEscritaImediata<T>(fn: () => Promise<T>): Promise<T> {
  escritaImediataDepth += 1
  try {
    return await fn()
  } finally {
    escritaImediataDepth -= 1
  }
}

function defaultIdOf(entity: unknown): string {
  return String((entity as { id?: unknown }).id ?? '')
}

/** Aplica uma mutação pendente sobre as linhas de uma aba. */
function aplicarMutacao(
  rows: readonly unknown[],
  mutation: { kind: string; entity?: unknown; entities?: readonly unknown[]; entityId?: string },
): unknown[] {
  switch (mutation.kind) {
    case 'append':
      return mutation.entity === undefined ? [...rows] : [...rows, mutation.entity]
    case 'replaceAll':
      return [...(mutation.entities ?? [])]
    case 'update': {
      if (mutation.entity === undefined) return [...rows]
      const id = mutation.entityId ?? defaultIdOf(mutation.entity)
      return rows.map((row) => (defaultIdOf(row) === id ? mutation.entity : row))
    }
    case 'remove':
      return rows.filter((row) => defaultIdOf(row) !== (mutation.entityId ?? ''))
    default:
      return [...rows]
  }
}

/**
 * Reaplica as mutações pendentes de uma aba sobre o cache recém-lido da origem.
 *
 * Deve ser chamada **apenas** depois de uma leitura da origem (cache = estado
 * remoto), nunca sobre um cache que já contém as pendências — senão um `append`
 * seria duplicado.
 */
export function aplicarPendenciasNoCache(
  spreadsheetId: string,
  sheetName: SheetName,
  options: OpcoesAplicarPendencias = {},
): void {
  const record = readSheetCache<unknown>(spreadsheetId, sheetName)
  if (!record) return

  const pendentes = listMutations().filter(
    (mutation) => mutation.sheet === sheetName && !options.excluirIds?.has(mutation.id),
  )
  if (pendentes.length === 0) return

  let rows: unknown[] = record.rows
  for (const mutation of pendentes) rows = aplicarMutacao(rows, mutation)
  writeSheetCache(spreadsheetId, sheetName, rows)
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
  const idOf = options.idOf ?? (defaultIdOf as (entity: T) => string)
  const outboxEnabled = options.outboxEnabled ?? true

  /** Aplica a mutação ao cache da aba (otimista) e a enfileira no outbox. */
  function applyOptimistic(context: RepositoryContext, draft: MutationDraft): void {
    const { spreadsheetId } = context
    const sheetName = repo.sheetName
    const cached = readSheetCache<T>(spreadsheetId, sheetName)

    // Sem cache não há o que atualizar: a próxima leitura busca a aba na origem
    // e reaplica as pendências (`aplicarPendenciasNoCache`). Escrever aqui um
    // cache parcial esconderia as demais linhas da aba.
    if (cached) {
      const current = cached.rows
      switch (draft.kind) {
        case 'append':
          writeSheetCache(spreadsheetId, sheetName, [...current, draft.entity as T])
          break
        case 'replaceAll':
          writeSheetCache(
            spreadsheetId,
            sheetName,
            (draft.entities as readonly T[] | undefined) ?? [],
          )
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
    } else if (draft.kind === 'replaceAll') {
      // `replaceAll` traz a aba inteira: é o próprio estado completo da aba.
      writeSheetCache(
        spreadsheetId,
        sheetName,
        (draft.entities as readonly T[] | undefined) ?? [],
      )
    }

    enqueue(draft)
  }

  /**
   * Escrita local-first: aplica no cache e enfileira, sem tocar na origem.
   *
   * Com o outbox desabilitado, no modo local ou dentro de `comEscritaImediata`,
   * delega ao repositório real.
   */
  function writeWithOutbox<TResult>(
    context: RepositoryContext,
    draft: MutationDraft,
    direct: () => Promise<TResult>,
    optimisticResult: () => TResult,
  ): Promise<TResult> {
    if (!outboxEnabled || isModoLocal() || isEscritaImediata()) return direct()

    applyOptimistic(context, draft)
    return Promise.resolve(optimisticResult())
  }

  /** Lê da origem e devolve o cache já com as pendências reaplicadas. */
  async function refreshComPendencias(context: RepositoryContext): Promise<T[]> {
    await repo.refresh(context)
    aplicarPendenciasNoCache(context.spreadsheetId, repo.sheetName)
    return repo.readCache(context.spreadsheetId) ?? []
  }

  const wrapped: Repository<T> = {
    sheetName: repo.sheetName,
    newId: () => repo.newId(),
    async list(context, listOptions) {
      if (!listOptions?.forceRefresh) {
        const cached = repo.readCache(context.spreadsheetId)
        if (cached) return cached
      }
      return refreshComPendencias(context)
    },
    readCache: (spreadsheetId) => repo.readCache(spreadsheetId),
    refresh: (context) => refreshComPendencias(context),
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
