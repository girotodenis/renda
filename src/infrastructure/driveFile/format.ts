import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import { gzip, gunzip } from '@/infrastructure/compression'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Codec do arquivo do banco de dados no Google Drive (`PLANO_DRIVE_JSON.md`).
 *
 * O banco inteiro é UM arquivo JSON compactado com gzip:
 *
 * ```json
 * { "version": 1, "sheets": { "Operacoes": [[...]], ... } }
 * ```
 *
 * Cada aba é a matriz bruta de células (`CellValue[][]`, linha 1 = cabeçalho),
 * exatamente o que o modo local guarda no IndexedDB e o que a exportação `.ods`
 * escreve. Reutilizar `CellValue` mantém um único tipo de célula em todo o app
 * (modo local, `.ods` e Drive), então o gateway JSON só precisa trocar o
 * transportador — nada de conversão paralela.
 *
 * Este módulo é **puro**: só codifica/decodifica bytes e normaliza o objeto já
 * parseado. Nenhuma chamada de rede.
 */

/** Versão atual do formato do arquivo do banco. */
export const DATABASE_FILE_VERSION = 1

/** Nome padrão do arquivo no Drive. */
export const DATABASE_FILE_NAME = 'minhasacoes.json.gz'

/** Matrizes de células por aba (todas as abas do schema). */
export type DatabaseSheets = Record<SheetName, CellValue[][]>

/** Conteúdo lógico do arquivo do banco (antes da compactação). */
export interface DatabaseFile {
  version: number
  sheets: DatabaseSheets
}

const INVALID_JSON_MESSAGE =
  'Arquivo do banco de dados inválido: não foi possível ler o JSON.'
const NEWER_VERSION_MESSAGE =
  'Este banco de dados foi criado por uma versão mais nova do app. Atualize o app para continuar.'
const INVALID_VERSION_MESSAGE =
  'Arquivo do banco de dados inválido: versão desconhecida.'
const MISSING_SHEETS_MESSAGE =
  'Arquivo do banco de dados inválido: as abas do banco não foram encontradas.'

/** Erro de formato do arquivo do banco (versão, estrutura ou JSON). */
export class DatabaseFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseFileError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyCell(cell: CellValue | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim().length === 0)
}

/** Célula válida no arquivo; qualquer outra coisa vira `null`. */
function sanitizeCell(value: unknown): CellValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return null
}

/** Sanitiza a matriz de uma aba; linhas que não são arrays são descartadas. */
function sanitizeRows(value: unknown): CellValue[][] {
  if (!Array.isArray(value)) return []

  const rows: CellValue[][] = []
  for (const row of value as unknown[]) {
    if (!Array.isArray(row)) continue
    rows.push((row as unknown[]).map(sanitizeCell))
  }
  return rows
}

function headerRow(name: SheetName): CellValue[] {
  return [...SHEET_HEADERS[name]]
}

/**
 * Completa o sufixo de cabeçalho que ainda falta.
 *
 * Mesma estratégia conservadora de `ensureLocalSheetsWithHeaders`: acha a última
 * célula preenchida da linha 1 e preenche dali em diante com os cabeçalhos do
 * schema. Nomes editados pelo usuário e colunas extras no fim são preservados.
 */
function withCompletedHeader(rows: CellValue[][], name: SheetName): CellValue[][] {
  const headers = SHEET_HEADERS[name]
  if (rows.length === 0) return [headerRow(name)]

  const header = rows[0]
  let lastFilled = -1
  for (let column = 0; column < header.length; column += 1) {
    if (!isEmptyCell(header[column])) lastFilled = column
  }
  if (lastFilled + 1 >= headers.length) return rows

  for (let column = lastFilled + 1; column < headers.length; column += 1) {
    header[column] = headers[column]
  }
  return rows
}

function normalizeVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DATABASE_FILE_VERSION
  if (value > DATABASE_FILE_VERSION) throw new DatabaseFileError(NEWER_VERSION_MESSAGE)
  if (value < 1) throw new DatabaseFileError(INVALID_VERSION_MESSAGE)
  return value
}

/** Banco novo: todas as abas do schema com apenas a linha de cabeçalho. */
export function emptyDatabase(version: number = DATABASE_FILE_VERSION): DatabaseFile {
  const sheets = {} as DatabaseSheets
  for (const name of SHEET_NAMES) sheets[name] = [headerRow(name)]
  return { version, sheets }
}

/** Serializa (TextEncoder) e comprime (gzip). */
export async function encodeDatabaseFile(
  sheets: DatabaseSheets,
  version: number = DATABASE_FILE_VERSION,
): Promise<Uint8Array> {
  const json = JSON.stringify({ version, sheets })
  return gzip(new TextEncoder().encode(json))
}

/** Descomprime (gunzip), decodifica (TextDecoder) e valida. */
export async function decodeDatabaseFile(bytes: Uint8Array): Promise<DatabaseFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(await gunzip(bytes)))
  } catch {
    throw new DatabaseFileError(INVALID_JSON_MESSAGE)
  }
  return normalizeDatabaseFile(parsed)
}

/** Normaliza um objeto já parseado: valida a versão e completa abas/cabeçalhos ausentes. */
export function normalizeDatabaseFile(raw: unknown): DatabaseFile {
  if (!isRecord(raw) || !isRecord(raw.sheets)) throw new DatabaseFileError(MISSING_SHEETS_MESSAGE)

  const rawSheets = raw.sheets
  const sheets = {} as DatabaseSheets
  for (const name of SHEET_NAMES) {
    sheets[name] = withCompletedHeader(sanitizeRows(rawSheets[name]), name)
  }

  return { version: normalizeVersion(raw.version), sheets }
}

/** `true` quando `normalizeDatabaseFile` mudaria algo (abas/cabeçalhos faltando). */
export function needsNormalization(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.sheets)) return true

  const rawSheets = raw.sheets
  const keys = Object.keys(rawSheets)
  if (keys.length !== SHEET_NAMES.length) return true
  if (!SHEET_NAMES.every((name) => Object.prototype.hasOwnProperty.call(rawSheets, name))) return true

  // Confere se o que está gravado já é exatamente o que a sanitização manteria.
  const preserved = {} as DatabaseSheets
  for (const name of SHEET_NAMES) {
    const rows = rawSheets[name]
    if (!Array.isArray(rows)) return true

    const copy: CellValue[][] = []
    for (const row of rows as unknown[]) {
      if (!Array.isArray(row)) return true
      const cells: CellValue[] = []
      for (const cell of row as unknown[]) {
        const sanitized = sanitizeCell(cell)
        if (sanitized !== cell) return true
        cells.push(sanitized)
      }
      copy.push(cells)
    }
    preserved[name] = copy
  }

  try {
    const normalized = normalizeDatabaseFile(raw)
    if (raw.version !== normalized.version) return true

    const current = JSON.stringify(normalized)
    const expected = JSON.stringify({ version: normalized.version, sheets: preserved })
    return current !== expected
  } catch {
    return true
  }
}
