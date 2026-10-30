import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import type { PlanilhaExistente, SheetIdMap, SpreadsheetWorkspace } from '@/domain/workspace'
import { gunzip } from '@/infrastructure/compression'
import {
  createDatabaseFile,
  getDriveFileRequestCount,
  GoogleDriveFileError,
  listAllDatabaseFiles,
  listDatabaseFiles,
  readDatabaseFile,
  resetDriveFileRequestCount,
  writeDatabaseFile,
} from '@/infrastructure/driveFile/api'
import {
  DatabaseFileError,
  emptyDatabase,
  encodeDatabaseFile,
  needsNormalization,
  normalizeDatabaseFile,
} from '@/infrastructure/driveFile/format'
import type { DatabaseFile, DatabaseSheets } from '@/infrastructure/driveFile/format'
import { parseA1Range } from '@/infrastructure/sheets/a1'
import type { EnderecoA1 } from '@/infrastructure/sheets/a1'
import { SheetsApiError } from '@/infrastructure/sheets/gateway'
import type { ValueInputOption, ValueRange, ValueRenderOption } from '@/infrastructure/sheets/gateway'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Gateway de células servido pelo arquivo JSON gzip do Google Drive
 * (`PLANO_DRIVE_JSON.md`) — **mesma superfície** de `sheets/gateway.ts`, para
 * que repositórios, codecs e casos de uso não percebam a troca do Sheets.
 *
 * O banco inteiro é UM arquivo: cada mutação é um *read-modify-write* (aplica a
 * operação A1 na matriz em memória, compacta e envia o arquivo de volta). Para
 * isso não custar uma ida-e-volta por linha existem três mecanismos:
 *
 * - **cache por sessão** (`Map` chaveado pelo id do arquivo): a segunda leitura
 *   em diante não faz download; `loadSpreadsheetWorkspace` e
 *   `createDefaultSpreadsheet` sempre releem do Drive e substituem a entrada;
 * - **lote** (`executarEmLote`): as mutações só marcam o arquivo como sujo e o
 *   flush grava uma única vez — no flush offline, N mutações custam
 *   **1 download + 1 upload** (o oposto do Sheets, que faria N chamadas);
 * - **concorrência por etag + `If-Match`**: HTTP 412 significa que outro
 *   dispositivo gravou no meio; o arquivo é relido e as mutações pendentes são
 *   reaplicadas sobre a versão remota (uma única nova tentativa).
 *
 * Todo erro do Drive vira `SheetsApiError` com o mesmo `status` e mensagem, para
 * `isOfflineWriteError` (0/429), `describeSheetsError`, `sync.ts` e
 * `AuthProvider` continuarem funcionando sem alteração.
 */

/** Título padrão do banco (nome exibido como "planilha ativa"). */
export const DEFAULT_DATABASE_TITLE = 'Minhas Ações — Carteira'

/** Sufixo do arquivo do banco no Drive. */
const DATABASE_SUFFIX = '.json.gz'

/** Locale fixo: o JSON não guarda locale e o app é pt-BR. */
const DATABASE_LOCALE = 'pt_BR'

const DEFAULT_RENDER_OPTION: ValueRenderOption = 'UNFORMATTED_VALUE'

export { columnLetter, DEFAULT_SPREADSHEET_TITLE, describeSheetsError, isQuotaError, SheetsApiError } from '@/infrastructure/sheets/gateway'
export type { ValueInputOption, ValueRange, ValueRenderOption } from '@/infrastructure/sheets/gateway'

/** Quantas requisições HTTP foram feitas ao Drive (diagnóstico/cache). */
export function getSheetsRequestCount(): number {
  return getDriveFileRequestCount()
}

/** Zera o contador de requisições (diagnóstico/cache). */
export function resetSheetsRequestCount(): void {
  resetDriveFileRequestCount()
}

/* --------------------------------------------------------------------------
 * Erros
 * ------------------------------------------------------------------------ */

/** Converte qualquer falha em `SheetsApiError` (contrato esperado pelo app). */
function toSheetsError(error: unknown): SheetsApiError {
  if (error instanceof SheetsApiError) return error
  if (error instanceof GoogleDriveFileError) {
    return new SheetsApiError(error.status, error.message)
  }
  if (error instanceof DatabaseFileError) {
    return new SheetsApiError(500, error.message)
  }
  if (error instanceof Error && error.message.length > 0) {
    return new SheetsApiError(0, error.message)
  }
  return new SheetsApiError(0, 'Ocorreu um erro inesperado ao acessar o banco de dados.')
}

/* --------------------------------------------------------------------------
 * Operações puras sobre as matrizes de células (semântica do modo local)
 * ------------------------------------------------------------------------ */

/** Mutação registrada em `pendingOps` e reaplicada após um conflito (412). */
type PendingOp =
  | { readonly type: 'write'; readonly address: EnderecoA1; readonly values: CellValue[][] }
  | { readonly type: 'append'; readonly address: EnderecoA1; readonly values: CellValue[][] }
  | { readonly type: 'clear'; readonly address: EnderecoA1 }
  | { readonly type: 'ensureSheets' }
  | { readonly type: 'ensureHeaders' }

function isEmptyCell(cell: CellValue | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim().length === 0)
}

function isEmptyRow(row: readonly CellValue[] | undefined): boolean {
  return !row || row.every((cell) => isEmptyCell(cell))
}

function trimTrailingEmptyRows(rows: CellValue[][]): CellValue[][] {
  let end = rows.length
  while (end > 0 && isEmptyRow(rows[end - 1])) end -= 1
  return rows.slice(0, end)
}

function copyMatrix(rows: readonly (readonly CellValue[])[]): CellValue[][] {
  return rows.map((row) => row.slice())
}

function asSheetName(name: string): SheetName {
  return name as SheetName
}

/** Matriz da aba (cria uma vazia quando a aba ainda não existe no arquivo). */
function matrixFor(sheets: DatabaseSheets, sheetName: string): CellValue[][] {
  const name = asSheetName(sheetName)
  const rows = sheets[name]
  if (Array.isArray(rows)) return rows

  const created: CellValue[][] = []
  sheets[name] = created
  return created
}

function rowsOf(sheets: DatabaseSheets, sheetName: string): CellValue[][] {
  const rows = sheets[asSheetName(sheetName)]
  return Array.isArray(rows) ? rows : []
}

/** Recorta o intervalo (linhas × colunas) e descarta linhas vazias no fim. */
function readRange(rows: readonly CellValue[][], address: EnderecoA1): CellValue[][] {
  const end = address.endRow === null ? rows.length : address.endRow + 1
  const selected = rows
    .slice(address.startRow, end)
    .map((row) => row.slice(address.startColumn, address.endColumn + 1))
  return trimTrailingEmptyRows(selected)
}

/** Escreve a partir da célula inicial, crescendo a matriz com `null`. */
function writeRange(
  rows: CellValue[][],
  address: EnderecoA1,
  values: readonly (readonly CellValue[])[],
): CellValue[][] {
  values.forEach((line, index) => {
    const rowIndex = address.startRow + index
    while (rows.length <= rowIndex) rows.push([])

    const row = rows[rowIndex]
    const width = address.startColumn + line.length
    while (row.length < width) row.push(null)

    line.forEach((cell, offset) => {
      row[address.startColumn + offset] = cell ?? null
    })
  })

  return trimTrailingEmptyRows(rows)
}

/** Acrescenta depois da última linha com conteúdo a partir de `startRow`. */
function appendRange(
  rows: CellValue[][],
  address: EnderecoA1,
  values: readonly (readonly CellValue[])[],
): CellValue[][] {
  let lastContentRow = address.startRow - 1
  for (let index = address.startRow; index < rows.length; index += 1) {
    if (!isEmptyRow(rows[index])) lastContentRow = index
  }
  return writeRange(rows, { ...address, startRow: lastContentRow + 1 }, values)
}

/** Zera as células do intervalo, preservando o resto da aba. */
function clearRange(rows: CellValue[][], address: EnderecoA1): CellValue[][] {
  const lastRow = address.endRow === null ? rows.length - 1 : Math.min(address.endRow, rows.length - 1)

  for (let rowIndex = address.startRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row) continue
    for (let column = address.startColumn; column <= address.endColumn; column += 1) {
      if (column < row.length) row[column] = null
    }
  }

  return trimTrailingEmptyRows(rows)
}

function headerRow(name: SheetName): CellValue[] {
  return [...SHEET_HEADERS[name]]
}

/** Cria as abas ausentes com a linha de cabeçalho; devolve quantas criou. */
function ensureSheets(sheets: DatabaseSheets): number {
  let created = 0
  for (const name of SHEET_NAMES) {
    if (rowsOf(sheets, name).length > 0) continue
    sheets[name] = [headerRow(name)]
    created += 1
  }
  return created
}

/**
 * Completa apenas o **sufixo** do cabeçalho da linha 1 (da última célula
 * preenchida em diante), preservando nomes editados e colunas extras.
 */
function ensureHeaders(sheets: DatabaseSheets): number {
  let updated = 0

  for (const name of SHEET_NAMES) {
    const rows = rowsOf(sheets, name)
    if (rows.length === 0) continue

    const expected = SHEET_HEADERS[name]
    const header = rows[0] ?? []
    let lastFilled = -1
    for (let column = 0; column < header.length; column += 1) {
      if (!isEmptyCell(header[column])) lastFilled = column
    }
    if (lastFilled + 1 >= expected.length) continue

    for (let column = lastFilled + 1; column < expected.length; column += 1) {
      header[column] = expected[column]
    }
    rows[0] = header
    updated += 1
  }

  return updated
}

/** Aplica a operação na matriz em memória e devolve o contador das `ensure*`. */
function applyOp(sheets: DatabaseSheets, op: PendingOp): number {
  if (op.type === 'write') {
    const name = asSheetName(op.address.sheetName)
    sheets[name] = writeRange(matrixFor(sheets, op.address.sheetName), op.address, op.values)
    return 0
  }

  if (op.type === 'append') {
    const name = asSheetName(op.address.sheetName)
    sheets[name] = appendRange(matrixFor(sheets, op.address.sheetName), op.address, op.values)
    return 0
  }

  if (op.type === 'clear') {
    const name = asSheetName(op.address.sheetName)
    sheets[name] = clearRange(matrixFor(sheets, op.address.sheetName), op.address)
    return 0
  }

  return op.type === 'ensureSheets' ? ensureSheets(sheets) : ensureHeaders(sheets)
}

/* --------------------------------------------------------------------------
 * Código do arquivo → banco em memória
 * ------------------------------------------------------------------------ */

/** Célula válida no arquivo; qualquer outra coisa vira `null`. */
function sanitizeCell(value: unknown): CellValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return null
}

function sanitizeRows(rows: readonly unknown[]): CellValue[][] {
  const result: CellValue[][] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    result.push((row as unknown[]).map(sanitizeCell))
  }
  return result
}

/** Descompacta e parseia o arquivo (erros viram `SheetsApiError` 500). */
async function parseDatabaseBytes(bytes: Uint8Array): Promise<unknown> {
  let text: string
  try {
    text = new TextDecoder().decode(await gunzip(bytes))
  } catch {
    throw new SheetsApiError(500, 'Não foi possível descompactar o arquivo do banco de dados.')
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new SheetsApiError(500, 'Arquivo do banco de dados inválido: não foi possível ler o JSON.')
  }
}

/**
 * Banco em memória a partir do objeto lido.
 *
 * O arquivo é preservado **como está** (abas e colunas ausentes continuam
 * ausentes): quem decide o que migrar são `ensureRequiredSheets` e
 * `ensureSheetHeaders`, exatamente como no modo local. A validação de
 * versão/estrutura fica com o codec (`normalizeDatabaseFile`).
 */
function toDatabase(raw: unknown): DatabaseFile {
  let version: number
  try {
    version = normalizeDatabaseFile(raw).version
  } catch (error) {
    throw toSheetsError(error)
  }

  // `normalizeDatabaseFile` acabou de validar que `raw.sheets` é um objeto.
  const origem = (raw as { sheets: Record<string, unknown> }).sheets
  const sheets = {} as DatabaseSheets
  for (const name of SHEET_NAMES) {
    const rows = origem[name]
    sheets[name] = Array.isArray(rows) ? sanitizeRows(rows) : []
  }

  return { version, sheets }
}

/* --------------------------------------------------------------------------
 * Cache da sessão + persistência
 * ------------------------------------------------------------------------ */

interface Entry {
  db: DatabaseFile
  etag: string | null
  title: string | null
  pendingOps: PendingOp[]
}

const cache = new Map<string, Entry>()

/** Nome do arquivo do banco para um título (`<título>.json.gz`). */
export function databaseFileName(title: string): string {
  const trimmed = title.trim()
  const resolved = trimmed.length > 0 ? trimmed : DEFAULT_DATABASE_TITLE
  return `${resolved}${DATABASE_SUFFIX}`
}

/** Título do workspace: nome do arquivo sem o sufixo `.json.gz`. */
function titleFromFileName(name: string | null): string {
  const trimmed = (name ?? '').trim()
  if (trimmed.length === 0) return DEFAULT_DATABASE_TITLE

  const withoutSuffix = trimmed.toLowerCase().endsWith(DATABASE_SUFFIX)
    ? trimmed.slice(0, -DATABASE_SUFFIX.length)
    : trimmed
  const title = withoutSuffix.trim()
  return title.length > 0 ? title : DEFAULT_DATABASE_TITLE
}

function buildSheetIdMap(): SheetIdMap {
  const map = {} as SheetIdMap
  SHEET_NAMES.forEach((name, index) => {
    map[name] = index
  })
  return map
}

function toWorkspace(fileId: string, title: string | null): SpreadsheetWorkspace {
  return {
    spreadsheetId: fileId,
    title: title ?? DEFAULT_DATABASE_TITLE,
    spreadsheetUrl: `https://drive.google.com/file/d/${fileId}/view`,
    sheetIds: buildSheetIdMap(),
    updatedAt: new Date().toISOString(),
  }
}

async function fetchEntry(accessToken: string, fileId: string): Promise<{ entry: Entry; raw: unknown }> {
  let read: Awaited<ReturnType<typeof readDatabaseFile>>
  try {
    read = await readDatabaseFile(accessToken, fileId)
  } catch (error) {
    throw toSheetsError(error)
  }

  const raw = await parseDatabaseBytes(read.bytes)
  const entry: Entry = {
    db: toDatabase(raw),
    etag: read.etag,
    title: titleFromFileName(read.name),
    pendingOps: [],
  }
  return { entry, raw }
}

/** Entrada em cache do arquivo (baixa só na primeira vez da sessão). */
async function loadEntry(accessToken: string, fileId: string): Promise<Entry> {
  const cached = cache.get(fileId)
  if (cached) return cached

  const { entry } = await fetchEntry(accessToken, fileId)
  cache.set(fileId, entry)
  return entry
}

/** Envia o banco em memória e, se deu certo, limpa as mutações pendentes. */
async function uploadDatabase(
  accessToken: string,
  fileId: string,
  entry: Entry,
  etag: string | null,
): Promise<void> {
  const bytes = await encodeDatabaseFile(entry.db.sheets, entry.db.version)
  const written = await writeDatabaseFile(accessToken, fileId, bytes, etag)
  entry.etag = written.etag
  entry.pendingOps = []
}

/** 412: relê o arquivo, reaplica as mutações pendentes e grava uma vez. */
async function resolveConflict(accessToken: string, fileId: string, entry: Entry): Promise<void> {
  const read = await readDatabaseFile(accessToken, fileId)
  const remote = toDatabase(await parseDatabaseBytes(read.bytes))

  for (const op of entry.pendingOps) applyOp(remote.sheets, op)

  entry.db = remote
  entry.etag = read.etag
  entry.title = titleFromFileName(read.name)
  await uploadDatabase(accessToken, fileId, entry, read.etag)
}

/**
 * Grava o banco do arquivo no Drive.
 *
 * Falha em qualquer ponto (inclusive na segunda tentativa de conflito) descarta
 * a entrada do cache: o estado local pode estar à frente do arquivo, e o outbox
 * reaplica a mutação do zero (sem duplicar linhas).
 */
async function persist(accessToken: string, fileId: string): Promise<void> {
  const entry = cache.get(fileId)
  if (!entry) return

  try {
    await uploadDatabase(accessToken, fileId, entry, entry.etag)
    return
  } catch (error) {
    if (!(error instanceof GoogleDriveFileError) || !error.isConflict) {
      cache.delete(fileId)
      throw toSheetsError(error)
    }
  }

  try {
    await resolveConflict(accessToken, fileId, entry)
  } catch (error) {
    cache.delete(fileId)
    throw toSheetsError(error)
  }
}

/* --------------------------------------------------------------------------
 * Lote (1 download + 1 upload para N mutações)
 * ------------------------------------------------------------------------ */

let batchDepth = 0
/** Arquivos com mutações em memória aguardando o flush (`fileId` → token). */
const dirty = new Map<string, string>()

/**
 * Registra a mutação já aplicada em memória. Dentro de um lote só marca o
 * arquivo como sujo; fora dele o chamador grava na hora.
 */
function registerChange(accessToken: string, fileId: string, op: PendingOp): void {
  const entry = cache.get(fileId)
  if (entry) entry.pendingOps.push(op)

  if (batchDepth > 0) dirty.set(fileId, accessToken)
}

/**
 * Agrupa várias mutações em um único read-modify-write.
 *
 * As operações dentro do lote só marcam o arquivo como sujo; o flush acontece no
 * fim (ou mesmo quando `fn` falha, para não perder o que já foi aplicado em
 * memória). É o caminho do flush offline do `sync.ts`.
 */
export async function executarEmLote<T>(
  accessToken: string,
  spreadsheetId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // O flush usa o mapa `dirty` (um lote pode tocar mais de um arquivo); os
  // parâmetros ficam para manter a assinatura de "escrever no arquivo aberto".
  void accessToken
  void spreadsheetId

  batchDepth += 1
  let falhou = false

  try {
    return await fn()
  } catch (error) {
    falhou = true
    throw error
  } finally {
    batchDepth -= 1
    if (batchDepth === 0) {
      const sujos = [...dirty]
      dirty.clear()
      for (const [fileId, token] of sujos) {
        if (falhou) {
          await persist(token, fileId).catch(() => undefined)
        } else {
          await persist(token, fileId)
        }
      }
    }
  }
}

/* --------------------------------------------------------------------------
 * API de valores (`spreadsheets.values`)
 * ------------------------------------------------------------------------ */

/** Lê um intervalo (`spreadsheets.values.get`). */
export async function getValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  renderOption: ValueRenderOption = DEFAULT_RENDER_OPTION,
): Promise<CellValue[][]> {
  // O arquivo guarda valores brutos: toda opção de render devolve a mesma matriz.
  void renderOption

  const address = parseA1Range(range)
  if (!address || address.sheetName.length === 0) return []

  const entry = await loadEntry(accessToken, spreadsheetId)
  return readRange(rowsOf(entry.db.sheets, address.sheetName), address)
}

/** Lê vários intervalos (`spreadsheets.values.batchGet`) com um único download. */
export async function batchGetValues(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
  renderOption: ValueRenderOption = DEFAULT_RENDER_OPTION,
): Promise<ValueRange[]> {
  void renderOption
  if (ranges.length === 0) return []

  const entry = await loadEntry(accessToken, spreadsheetId)

  return ranges.map((range) => {
    const address = parseA1Range(range)
    const values = address && address.sheetName.length > 0
      ? readRange(rowsOf(entry.db.sheets, address.sheetName), address)
      : []
    return { range, majorDimension: 'ROWS' as const, values }
  })
}

/** Escreve valores em um intervalo (`spreadsheets.values.update`). */
export async function updateValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption: ValueInputOption = 'RAW',
): Promise<void> {
  void inputOption

  const address = parseA1Range(range)
  if (!address || address.sheetName.length === 0 || values.length === 0) return

  const entry = await loadEntry(accessToken, spreadsheetId)
  const op: PendingOp = { type: 'write', address, values: copyMatrix(values) }
  applyOp(entry.db.sheets, op)
  registerChange(accessToken, spreadsheetId, op)
  if (batchDepth === 0) await persist(accessToken, spreadsheetId)
}

/** Escreve vários intervalos em um único upload (`spreadsheets.values.batchUpdate`). */
export async function batchUpdateValues(
  accessToken: string,
  spreadsheetId: string,
  data: readonly ValueRange[],
  inputOption: ValueInputOption = 'RAW',
): Promise<void> {
  void inputOption
  if (data.length === 0) return

  const entry = await loadEntry(accessToken, spreadsheetId)
  let changed = false

  for (const valueRange of data) {
    const address = parseA1Range(valueRange.range)
    const rows = valueRange.values ?? []
    if (!address || address.sheetName.length === 0 || rows.length === 0) continue

    const op: PendingOp = { type: 'write', address, values: copyMatrix(rows) }
    applyOp(entry.db.sheets, op)
    entry.pendingOps.push(op)
    changed = true
  }

  if (!changed) return

  if (batchDepth > 0) {
    dirty.set(spreadsheetId, accessToken)
    return
  }
  await persist(accessToken, spreadsheetId)
}

/** Acrescenta linhas ao final da tabela (`spreadsheets.values.append`). */
export async function appendValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption: ValueInputOption = 'RAW',
): Promise<void> {
  void inputOption

  const address = parseA1Range(range)
  if (!address || address.sheetName.length === 0 || values.length === 0) return

  const entry = await loadEntry(accessToken, spreadsheetId)
  const op: PendingOp = { type: 'append', address, values: copyMatrix(values) }
  applyOp(entry.db.sheets, op)
  registerChange(accessToken, spreadsheetId, op)
  if (batchDepth === 0) await persist(accessToken, spreadsheetId)
}

/** Limpa (zera) as células do intervalo, preservando o resto (`values.clear`). */
export async function clearValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  const address = parseA1Range(range)
  if (!address || address.sheetName.length === 0) return

  const entry = await loadEntry(accessToken, spreadsheetId)
  const op: PendingOp = { type: 'clear', address }
  applyOp(entry.db.sheets, op)
  registerChange(accessToken, spreadsheetId, op)
  if (batchDepth === 0) await persist(accessToken, spreadsheetId)
}

/* --------------------------------------------------------------------------
 * Workspace (metadados, abas e cabeçalhos)
 * ------------------------------------------------------------------------ */

/**
 * Locale do banco — sempre `pt_BR` (não há API para consultar e o app/formulas
 * `.ods` são pt-BR). Mantém a assinatura usada pelo `gatewayRouter`.
 */
export async function getSpreadsheetLocale(
  accessToken: string,
  spreadsheetId: string,
  options?: { forceRefresh?: boolean },
): Promise<string | null> {
  void accessToken
  void spreadsheetId
  void options
  return DATABASE_LOCALE
}

/** Cria o arquivo do banco com as 7 abas (só cabeçalho) e o workspace. */
export async function createDefaultSpreadsheet(
  accessToken: string,
  title: string = DEFAULT_DATABASE_TITLE,
): Promise<SpreadsheetWorkspace> {
  const db = emptyDatabase()

  let created: Awaited<ReturnType<typeof createDatabaseFile>>
  try {
    const bytes = await encodeDatabaseFile(db.sheets, db.version)
    created = await createDatabaseFile(accessToken, databaseFileName(title), bytes)
  } catch (error) {
    throw toSheetsError(error)
  }

  const workspaceTitle = titleFromFileName(created.name)
  cache.set(created.fileId, { db, etag: created.etag, title: workspaceTitle, pendingOps: [] })

  return toWorkspace(created.fileId, workspaceTitle)
}

/**
 * Abre o banco existente: sempre relê o arquivo do Drive (ignora o cache),
 * normaliza quando o arquivo é de uma versão anterior e persiste a migração.
 */
export async function loadSpreadsheetWorkspace(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetWorkspace> {
  const { entry, raw } = await fetchEntry(accessToken, spreadsheetId)
  cache.set(spreadsheetId, entry)

  let migrar = false
  try {
    migrar = needsNormalization(raw)
  } catch {
    migrar = true
  }

  if (migrar) {
    try {
      entry.db = normalizeDatabaseFile(raw)
    } catch (error) {
      throw toSheetsError(error)
    }
    entry.pendingOps = []
    await persist(accessToken, spreadsheetId)
  }

  return toWorkspace(spreadsheetId, entry.title)
}

/** Garante as abas do schema (criando as ausentes com cabeçalho). */
export async function ensureRequiredSheets(
  accessToken: string,
  spreadsheetId: string,
): Promise<number> {
  const entry = await loadEntry(accessToken, spreadsheetId)
  const created = ensureSheets(entry.db.sheets)
  if (created > 0) {
    entry.pendingOps.push({ type: 'ensureSheets' })
    if (batchDepth > 0) dirty.set(spreadsheetId, accessToken)
    else await persist(accessToken, spreadsheetId)
  }
  return created
}

/** Garante o sufixo dos cabeçalhos das abas já existentes (idempotente). */
export async function ensureSheetHeaders(
  accessToken: string,
  spreadsheetId: string,
): Promise<number> {
  const entry = await loadEntry(accessToken, spreadsheetId)
  const updated = ensureHeaders(entry.db.sheets)
  if (updated > 0) {
    entry.pendingOps.push({ type: 'ensureHeaders' })
    if (batchDepth > 0) dirty.set(spreadsheetId, accessToken)
    else await persist(accessToken, spreadsheetId)
  }
  return updated
}

/** Lista os bancos com o nome derivado do título (abrir banco existente). */
export async function listDatabaseWorkspaces(
  accessToken: string,
  title: string,
): Promise<PlanilhaExistente[]> {
  let files: Awaited<ReturnType<typeof listDatabaseFiles>>
  try {
    files = await listDatabaseFiles(accessToken, databaseFileName(title))
  } catch (error) {
    throw toSheetsError(error)
  }

  return files.map((file) => ({
    spreadsheetId: file.fileId,
    title: titleFromFileName(file.name),
    modificadaEm: file.modifiedTime ?? null,
  }))
}

/** Lista todos os bancos criados pelo app (mais recente primeiro). */
export async function listAllDatabaseWorkspaces(
  accessToken: string,
): Promise<PlanilhaExistente[]> {
  let files: Awaited<ReturnType<typeof listAllDatabaseFiles>>
  try {
    files = await listAllDatabaseFiles(accessToken)
  } catch (error) {
    throw toSheetsError(error)
  }

  return files.map((file) => ({
    spreadsheetId: file.fileId,
    title: titleFromFileName(file.name),
    modificadaEm: file.modifiedTime ?? null,
  }))
}
