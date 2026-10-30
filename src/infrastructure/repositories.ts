import { newId } from '@/domain/ids'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { toCell } from '@/infrastructure/sheets/sheetCells'
import {
  ativosCodec,
  configuracoesCodec,
  consolidadoCodec,
  historicoCodec,
  metasCodec,
  operacoesCodec,
  proventosCodec,
  valuationCodec,
} from '@/infrastructure/sheets/sheetCodecs'
import type { SheetCodec } from '@/infrastructure/sheets/sheetCodecs'
import { SHEET_HEADERS } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import { invalidateSheetCache, readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import {
  appendValues,
  batchGetValues,
  clearValues,
  columnLetter,
  getValues,
  updateValues,
} from '@/infrastructure/sheets/gatewayRouter'
import type { Ativo, Configuracao, Consolidado, MetaRebalanceamento, Operacao, Provento, Snapshot, Valuation } from '@/domain/entities'

/**
 * Repositórios por aba (Seção 2) — abstraem a planilha como um banco de dados.
 *
 * Leitura **sempre do cache primeiro** (RNF02); a rede só é acionada se não
 * houver cache ou em refresh explícito. Escritas invalidam o cache da aba.
 */

// Os contratos de repositório (ports) pertencem ao domínio — a infraestrutura
// apenas os importa e implementa (inversão de dependência).
import type {
  CrudRepository,
  Repository,
  RepositoryContext,
} from '@/domain/repositories/ports'
import { withOfflineOutbox } from '@/infrastructure/offlineRepositories'
import type { Mutation } from '@/infrastructure/outbox'

export type {
  CrudRepository,
  ListOptions,
  Repository,
  RepositoryContext,
} from '@/domain/repositories/ports'

interface RepositoryConfig<T> {
  codec: SheetCodec<T>
  /**
   * Quantidade de colunas graváveis (a partir de A). As demais são preservadas
   * (ex.: `Consolidado` = 2 → só `Ticker` e `Categoria` são escritas, mantendo
   * as fórmulas das colunas calculadas).
   */
  writableColumnCount?: number
}

/** Intervalo de leitura que cobre todas as colunas de uma aba. */
function dataRangeFor(sheetName: SheetName): string {
  return `'${sheetName}'!A1:${columnLetter(SHEET_HEADERS[sheetName].length)}`
}

function isNonEmptyRow(row: readonly CellValue[]): boolean {
  return row.some((cell) => cell !== null && cell !== undefined && String(cell).trim().length > 0)
}

function cellRow(values: readonly CellValue[] | undefined): CellValue[] {
  return (values ?? []).map((value) => toCell(value))
}

/** Cria um repositório para uma aba a partir do seu codec linha ↔ entidade. */
export function createRepository<T>(config: RepositoryConfig<T>): Repository<T> {
  const { codec } = config
  const { sheetName } = codec
  const writableColumnCount = config.writableColumnCount ?? SHEET_HEADERS[sheetName].length
  const dataRange = dataRangeFor(sheetName)

  function decodeRows(values: readonly CellValue[][]): T[] {
    return values
      .slice(1)
      .filter(isNonEmptyRow)
      .map((row) => codec.fromRow(row))
  }

  async function refresh(context: RepositoryContext): Promise<T[]> {
    const values = await getValues(context.accessToken, context.spreadsheetId, dataRange)
    const entities = decodeRows(values)
    writeSheetCache(context.spreadsheetId, sheetName, entities)
    return entities
  }

  return {
    sheetName,
    newId,

    async list(context, options) {
      if (!options?.forceRefresh) {
        const cached = readSheetCache<T>(context.spreadsheetId, sheetName)
        if (cached) return cached.rows
      }
      return refresh(context)
    },

    readCache(spreadsheetId) {
      return readSheetCache<T>(spreadsheetId, sheetName)?.rows ?? null
    },

    refresh,

    async append(context, entity) {
      const row = cellRow(codec.toRow(entity)).slice(0, writableColumnCount)
      await appendValues(context.accessToken, context.spreadsheetId, `'${sheetName}'!A1`, [row])
      invalidateSheetCache(context.spreadsheetId, sheetName)
      return entity
    },

    async replaceAll(context, entities) {
      const writableColumns = columnLetter(writableColumnCount)
      // Limpa apenas as colunas graváveis a partir da linha 2, preservando o
      // cabeçalho e as colunas de fórmulas (ex.: `Consolidado`). A limpeza
      // prévia evita linhas órfãs quando a lista encolhe (exclusão).
      await clearValues(context.accessToken, context.spreadsheetId, `'${sheetName}'!A2:${writableColumns}`)
      const rows = entities.map((entity) =>
        cellRow(codec.toRow(entity)).slice(0, writableColumnCount),
      )
      if (rows.length > 0) {
        const range = `'${sheetName}'!A2:${writableColumns}${rows.length + 1}`
        await updateValues(context.accessToken, context.spreadsheetId, range, rows)
      }
      invalidateSheetCache(context.spreadsheetId, sheetName)
    },

    invalidateCache(spreadsheetId) {
      invalidateSheetCache(spreadsheetId, sheetName)
    },
  }
}

/**
 * Cria um repositório com CRUD completo (criar/listar/editar/excluir) para
 * abas cujas entidades possuem ID único (`Operacoes`, `Proventos`).
 *
 * Edição e exclusão reescrevem a região de dados da aba de forma segura:
 * primeiro relê os dados atuais da API (evita sobrescrever linhas alteradas
 * fora do app) e depois delega ao `replaceAll`, que limpa somente as colunas
 * graváveis — nunca as fórmulas do `Consolidado`.
 */
export function createCrudRepository<T>(
  config: RepositoryConfig<T> & { idOf: (entity: T) => string },
): CrudRepository<T> {
  const base = createRepository<T>(config)
  const { idOf } = config

  return {
    ...base,

    async update(context, entity) {
      const id = idOf(entity)
      const entities = await base.refresh(context)
      const index = entities.findIndex((item) => idOf(item) === id)
      if (index < 0) {
        throw new Error('Registro não encontrado na aba. Atualize a lista e tente novamente.')
      }
      const next = entities.slice()
      next[index] = entity
      await base.replaceAll(context, next)
      return entity
    },

    async remove(context, id) {
      const entities = await base.refresh(context)
      const next = entities.filter((item) => idOf(item) !== id)
      if (next.length === entities.length) {
        throw new Error('Registro não encontrado na aba. Atualize a lista e tente novamente.')
      }
      await base.replaceAll(context, next)
    },
  }
}

// IDs estáveis das entidades com CRUD (usados pelo `update`/`remove` offline).
const operacaoId = (operacao: Operacao): string => operacao.id
const proventoId = (provento: Provento): string => provento.id

// Repositórios **crus** (sem o decorador offline). Usados apenas pela
// sincronização da Fase 2 (`replayMutation`), que reaplica as mutações do
// outbox sem reenfileirá-las em caso de falha de rede.
const operacoesRepoRaw = createCrudRepository<Operacao>({ codec: operacoesCodec, idOf: operacaoId })
const proventosRepoRaw = createCrudRepository<Provento>({ codec: proventosCodec, idOf: proventoId })
const consolidadoRepoRaw = createRepository<Consolidado>({
  codec: consolidadoCodec,
  writableColumnCount: 2,
})
const metasRepoRaw = createRepository<MetaRebalanceamento>({ codec: metasCodec })
const historicoRepoRaw = createRepository<Snapshot>({ codec: historicoCodec })
const valuationRepoRaw = createRepository<Valuation>({ codec: valuationCodec })
const ativosRepoRaw = createRepository<Ativo>({ codec: ativosCodec })
const configuracoesRepoRaw = createRepository<Configuracao>({ codec: configuracoesCodec })

// Repositórios da camada de dados já **envoltos pelo decorador offline** (Fase 1):
// escritas sem rede (ou com falha de rede/quota) vão para o outbox e refletem no
// cache local imediatamente. O `Consolidado` é aba derivada — passa direto
// (sem outbox), pois é recalculado pela sincronização da Fase 2.
export const operacoesRepo = withOfflineOutbox(operacoesRepoRaw, { idOf: operacaoId })
export const proventosRepo = withOfflineOutbox(proventosRepoRaw, { idOf: proventoId })
export const consolidadoRepo = withOfflineOutbox(consolidadoRepoRaw, { outboxEnabled: false })
export const metasRepo = withOfflineOutbox(metasRepoRaw)
export const historicoRepo = withOfflineOutbox(historicoRepoRaw)
export const valuationRepo = withOfflineOutbox(valuationRepoRaw)
export const ativosRepo = withOfflineOutbox(ativosRepoRaw)
export const configuracoesRepo = withOfflineOutbox(configuracoesRepoRaw)

/**
 * Repositório cru (sem decorador) com os contratos apagados para `unknown`.
 *
 * A sincronização (Fase 2) precisa reaplicar as mutações do outbox **sem**
 * passar pelo decorador offline — caso contrário, uma falha de rede durante o
 * replay reenfileiraria a mesma mutação em loop. Este contrato expõe apenas o
 * necessário para o replay e para a checagem de idempotência do `append`.
 */
export interface RawSheetRepository {
  readonly sheetName: SheetName
  append(context: RepositoryContext, entity: unknown): Promise<unknown>
  replaceAll(context: RepositoryContext, entities: readonly unknown[]): Promise<void>
  update?(context: RepositoryContext, entity: unknown): Promise<unknown>
  remove?(context: RepositoryContext, id: string): Promise<void>
  /** Relê a aba da API (usado na checagem de idempotência do `append`). */
  refresh(context: RepositoryContext): Promise<unknown[]>
  /** Extrai o ID estável da entidade (apenas abas com IDs — `Operacoes`/`Proventos`). */
  idOf?(entity: unknown): string
}

/** Converte um repositório tipado em `RawSheetRepository` (type-erasure). */
function asRawSheetRepository<T>(
  repo: Repository<T>,
  idOf?: (entity: T) => string,
): RawSheetRepository {
  const crud = repo as Partial<CrudRepository<T>>
  return {
    sheetName: repo.sheetName,
    append: (context, entity) => repo.append(context, entity as T),
    replaceAll: (context, entities) => repo.replaceAll(context, entities as readonly T[]),
    update:
      typeof crud.update === 'function'
        ? (context, entity) =>
            (crud.update as (c: RepositoryContext, e: T) => Promise<T>)(context, entity as T)
        : undefined,
    remove:
      typeof crud.remove === 'function'
        ? (context, id) =>
            (crud.remove as (c: RepositoryContext, id: string) => Promise<void>)(context, id)
        : undefined,
    refresh: async (context) => repo.refresh(context),
    idOf: idOf ? (entity) => idOf(entity as T) : undefined,
  }
}

/** Repositórios crus por aba, usados pelo replay da sincronização (Fase 2). */
export const rawRepositories: Record<SheetName, RawSheetRepository> = {
  Operacoes: asRawSheetRepository(operacoesRepoRaw, operacaoId),
  Proventos: asRawSheetRepository(proventosRepoRaw, proventoId),
  Consolidado: asRawSheetRepository(consolidadoRepoRaw),
  Metas_Rebalanceamento: asRawSheetRepository(metasRepoRaw),
  Historico: asRawSheetRepository(historicoRepoRaw),
  Valuation: asRawSheetRepository(valuationRepoRaw),
  Ativos: asRawSheetRepository(ativosRepoRaw),
  Configuracoes: asRawSheetRepository(configuracoesRepoRaw),
}

/**
 * Reaplica uma mutação do outbox diretamente no repositório cru correspondente.
 *
 * **Não** passa pelo decorador offline: em falha de rede o erro é propagado ao
 * chamador (que decide se mantém o item na fila), sem reenfileirar. Para
 * `update`/`remove`, o CRUD cru já relê a aba antes de reescrever (re-leitura
 * segura).
 */
export async function replayMutation(
  context: RepositoryContext,
  mutation: Mutation,
): Promise<void> {
  const repo = rawRepositories[mutation.sheet]
  if (!repo) throw new Error(`Aba desconhecida no outbox: ${mutation.sheet}`)

  switch (mutation.kind) {
    case 'append':
      if (mutation.entity === undefined) throw new Error('Mutação append sem entity.')
      await repo.append(context, mutation.entity)
      return
    case 'replaceAll':
      await repo.replaceAll(context, mutation.entities ?? [])
      return
    case 'update': {
      if (!repo.update) throw new Error(`Aba ${mutation.sheet} não suporta update.`)
      if (mutation.entity === undefined) throw new Error('Mutação update sem entity.')
      await repo.update(context, mutation.entity)
      return
    }
    case 'remove': {
      if (!repo.remove) throw new Error(`Aba ${mutation.sheet} não suporta remove.`)
      await repo.remove(context, mutation.entityId ?? '')
      return
    }
  }
}

interface SheetReader {
  sheetName: SheetName
  fromRow(row: readonly CellValue[]): unknown
}

/** Leitores por aba usados para leitura agrupada em uma única `batchGet`. */
const sheetReaders: readonly SheetReader[] = [
  { sheetName: 'Operacoes', fromRow: (row) => operacoesCodec.fromRow(row) },
  { sheetName: 'Proventos', fromRow: (row) => proventosCodec.fromRow(row) },
  { sheetName: 'Consolidado', fromRow: (row) => consolidadoCodec.fromRow(row) },
  { sheetName: 'Metas_Rebalanceamento', fromRow: (row) => metasCodec.fromRow(row) },
  { sheetName: 'Historico', fromRow: (row) => historicoCodec.fromRow(row) },
]

/**
 * Lê todas as abas em **uma única chamada** `values.batchGet` e atualiza o cache
 * (RNF02). Retorna quantos intervalos foram lidos.
 */
export async function prefetchAllSheets(context: RepositoryContext): Promise<number> {
  const ranges = sheetReaders.map((reader) => dataRangeFor(reader.sheetName))
  const valueRanges = await batchGetValues(context.accessToken, context.spreadsheetId, ranges)

  valueRanges.forEach((valueRange, index) => {
    const reader = sheetReaders[index]
    if (!reader) return
    const rows = (valueRange.values ?? [])
      .slice(1)
      .filter(isNonEmptyRow)
      .map((row) => reader.fromRow(row))
    writeSheetCache(context.spreadsheetId, reader.sheetName, rows)
  })

  return valueRanges.length
}
