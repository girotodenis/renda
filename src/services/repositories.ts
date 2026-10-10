import { newId } from '@/lib/ids'
import type { CellValue } from '@/lib/sheetCells'
import { toCell } from '@/lib/sheetCells'
import {
  consolidadoCodec,
  historicoCodec,
  metasCodec,
  operacoesCodec,
  proventosCodec,
} from '@/lib/sheetCodecs'
import type { SheetCodec } from '@/lib/sheetCodecs'
import { SHEET_HEADERS } from '@/lib/sheetsSchema'
import type { SheetName } from '@/lib/sheetsSchema'
import { invalidateSheetCache, readSheetCache, writeSheetCache } from '@/services/cache'
import {
  appendValues,
  batchGetValues,
  clearValues,
  columnLetter,
  getValues,
  updateValues,
} from '@/services/sheets'
import type { Consolidado, MetaRebalanceamento, Operacao, Provento, Snapshot } from '@/types/domain'

/**
 * Repositórios por aba (Seção 2) — abstraem a planilha como um banco de dados.
 *
 * Leitura **sempre do cache primeiro** (RNF02); a rede só é acionada se não
 * houver cache ou em refresh explícito. Escritas invalidam o cache da aba.
 */

/** Contexto de acesso: token OAuth + planilha ativa. */
export interface RepositoryContext {
  accessToken: string
  spreadsheetId: string
}

export interface ListOptions {
  /** Ignora o cache e busca direto da API (refresh explícito do usuário). */
  forceRefresh?: boolean
}

/** Contrato de um repositório de aba. */
export interface Repository<T> {
  readonly sheetName: SheetName
  /** Gera um novo ID (UUID/timestamp) — nunca reutilizado. */
  newId(): string
  /** Lê do cache quando disponível; senão busca da API e popula o cache. */
  list(context: RepositoryContext, options?: ListOptions): Promise<T[]>
  /** Lê apenas o cache da aba (sem rede) — `null` quando ausente. */
  readCache(spreadsheetId: string): T[] | null
  /** Busca dados atuais da API e atualiza o cache. */
  refresh(context: RepositoryContext): Promise<T[]>
  /** Acrescenta uma entidade e invalida o cache da aba. */
  append(context: RepositoryContext, entity: T): Promise<T>
  /** Substitui as linhas de dados da aba (preserva colunas de fórmulas). */
  replaceAll(context: RepositoryContext, entities: readonly T[]): Promise<void>
  /** Invalida o cache da aba. */
  invalidateCache(spreadsheetId: string): void
}

interface RepositoryConfig<T> {
  codec: SheetCodec<T>
  /**
   * Quantidade de colunas graváveis (a partir de A). As demais são preservadas
   * (ex.: `Consolidado` = 2 → só `Ticker` e `Categoria` são escritas, mantendo
   * as fórmulas das colunas calculadas).
   */
  writableColumnCount?: number
}

/** Repositório com CRUD completo para abas cujas entidades têm ID único. */
export interface CrudRepository<T> extends Repository<T> {
  /** Substitui a entidade de mesmo ID (re-escrita segura da aba). */
  update(context: RepositoryContext, entity: T): Promise<T>
  /** Remove a entidade pelo ID (re-escrita segura da aba). */
  remove(context: RepositoryContext, id: string): Promise<void>
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

export const operacoesRepo = createCrudRepository<Operacao>({
  codec: operacoesCodec,
  idOf: (operacao) => operacao.id,
})
export const proventosRepo = createCrudRepository<Provento>({
  codec: proventosCodec,
  idOf: (provento) => provento.id,
})
export const consolidadoRepo = createRepository<Consolidado>({
  codec: consolidadoCodec,
  writableColumnCount: 2,
})
export const metasRepo = createRepository<MetaRebalanceamento>({ codec: metasCodec })
export const historicoRepo = createRepository<Snapshot>({ codec: historicoCodec })

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
