import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { cellToText } from '@/infrastructure/sheets/sheetCells'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import type { SheetIdMap, SpreadsheetWorkspace } from '@/domain/workspace'

/**
 * Google Sheets API v4 — criação/leitura de planilhas e cabeçalhos.
 *
 * Esta é a única porta de saída de rede para a API do Sheets (RNF01).
 */

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export const DEFAULT_SPREADSHEET_TITLE = 'Minhas Ações — Carteira'

/** Tentativas extras automáticas (apenas HTTP 429: a requisição foi rejeitada). */
const MAX_QUOTA_RETRIES = 2
const RETRY_BASE_DELAY_MS = 500

let sheetsRequestCount = 0

/** Quantas requisições de rede à API do Sheets foram feitas (uso no diagnóstico). */
export function getSheetsRequestCount(): number {
  return sheetsRequestCount
}

/** Zera o contador de requisições (uso no diagnóstico de cache). */
export function resetSheetsRequestCount(): void {
  sheetsRequestCount = 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Erro retornado pela API do Google Sheets. */
export class SheetsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SheetsApiError'
  }
}

/** `true` quando o erro indica estouro de quota (HTTP 429) da API do Google. */
export function isQuotaError(error: unknown): boolean {
  return error instanceof SheetsApiError && error.status === 429
}

/** Mensagem amigável (pt-BR) para erros da API do Sheets (RNF04). */
export function describeSheetsError(error: unknown): string {
  if (error instanceof SheetsApiError) {
    if (error.status === 401) return 'Sessão expirada. Faça login novamente.'
    if (error.status === 403) {
      return 'Permissão negada pelo Google. Verifique se as APIs Sheets/Drive estão habilitadas.'
    }
    if (error.status === 429) return 'Cota da API do Google excedida. Tente novamente em instantes.'
    if (error.status === 0) return error.message
    return `Erro na API do Google Sheets: ${error.message}`
  }
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Ocorreu um erro inesperado ao acessar a planilha.'
}

interface SheetsApiSheetProperties {
  sheetId: number
  title: string
  index: number
}

interface SheetsApiSheet {
  properties: SheetsApiSheetProperties
}

interface SheetsApiSpreadsheet {
  spreadsheetId: string
  spreadsheetUrl?: string
  properties: { title: string }
  sheets?: SheetsApiSheet[]
}

interface SheetsApiBatchUpdateResponse {
  replies?: { addSheet?: { properties: SheetsApiSheetProperties } }[]
}

interface HeaderRowData {
  rowData: {
    values: {
      userEnteredValue: { stringValue: string }
      userEnteredFormat: { textFormat: { bold: boolean } }
    }[]
  }[]
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    const message = body.error?.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch {
    // Corpo não é JSON — usa a mensagem padrão abaixo.
  }
  return `Falha na API do Google Sheets (HTTP ${response.status}).`
}

async function sheetsRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()

  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    sheetsRequestCount += 1
    try {
      response = await fetch(`${SHEETS_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      })
    } catch {
      // Erro de rede: reintenta apenas leituras idempotentes para não duplicar escritas.
      if (method === 'GET' && attempt < MAX_QUOTA_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
        continue
      }
      throw new SheetsApiError(0, 'Falha de rede ao acessar o Google. Verifique sua conexão.')
    }

    if (response.status === 429 && attempt < MAX_QUOTA_RETRIES) {
      const retryAfter = Number(response.headers.get('Retry-After'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * (attempt + 1)
      await sleep(delay)
      continue
    }

    if (!response.ok) {
      throw new SheetsApiError(response.status, await readErrorMessage(response))
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }
}

/** Converte um índice de coluna (1-based) na letra A1 (ex.: 12 → "L"). */
export function columnLetter(count: number): string {
  let letters = ''
  let remaining = count
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letters
}

function buildHeaderRowData(name: SheetName): HeaderRowData {
  return {
    rowData: [
      {
        values: SHEET_HEADERS[name].map((header) => ({
          userEnteredValue: { stringValue: header },
          userEnteredFormat: { textFormat: { bold: true } },
        })),
      },
    ],
  }
}

function buildSheetIdMap(entries: readonly [SheetName, number][]): SheetIdMap {
  const map = {} as SheetIdMap
  for (const [name, sheetId] of entries) {
    map[name] = sheetId
  }
  return map
}

function toWorkspace(spreadsheet: SheetsApiSpreadsheet, ids: Map<string, number>): SpreadsheetWorkspace {
  const missing = SHEET_NAMES.filter((name) => !ids.has(name))
  if (missing.length > 0) {
    throw new SheetsApiError(500, `A planilha não possui as abas obrigatórias: ${missing.join(', ')}.`)
  }

  return {
    spreadsheetId: spreadsheet.spreadsheetId,
    title: spreadsheet.properties.title,
    spreadsheetUrl: spreadsheet.spreadsheetUrl ?? null,
    sheetIds: buildSheetIdMap(SHEET_NAMES.map((name) => [name, ids.get(name) ?? 0])),
    updatedAt: new Date().toISOString(),
  }
}

function collectSheetIds(spreadsheet: SheetsApiSpreadsheet): Map<string, number> {
  const ids = new Map<string, number>()
  for (const sheet of spreadsheet.sheets ?? []) {
    ids.set(sheet.properties.title, sheet.properties.sheetId)
  }
  return ids
}

interface SpreadsheetLocaleResponse {
  properties?: { locale?: string }
}

/** Cache em memória do locale por planilha (define o separador das fórmulas). */
const localeCache = new Map<string, string | null>()

/**
 * Lê o locale da planilha (best-effort, com cache em memória). O locale define o
 * separador de argumentos das fórmulas (`;` no Brasil, `,` em locales `en`).
 * Falhas retornam `null` (o chamador assume o separador padrão `;`).
 */
export async function getSpreadsheetLocale(
  accessToken: string,
  spreadsheetId: string,
  options?: { forceRefresh?: boolean },
): Promise<string | null> {
  if (!options?.forceRefresh && localeCache.has(spreadsheetId)) {
    return localeCache.get(spreadsheetId) ?? null
  }

  try {
    const response = await sheetsRequest<SpreadsheetLocaleResponse>(
      accessToken,
      `/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent('properties.locale')}`,
    )
    const locale = response.properties?.locale ?? null
    localeCache.set(spreadsheetId, locale)
    return locale
  } catch {
    return null
  }
}


/**
 * Cria uma planilha padrão com as 5 abas da especificação, cabeçalhos já
 * escritos e linha de cabeçalho congelada (RF02).
 */
export async function createDefaultSpreadsheet(
  accessToken: string,
  title: string = DEFAULT_SPREADSHEET_TITLE,
): Promise<SpreadsheetWorkspace> {
  const trimmedTitle = title.trim().length > 0 ? title.trim() : DEFAULT_SPREADSHEET_TITLE

  const body = {
    properties: {
      title: trimmedTitle,
      locale: 'pt_BR',
      timeZone: 'America/Sao_Paulo',
    },
    sheets: SHEET_NAMES.map((name, index) => ({
      properties: {
        title: name,
        index,
        gridProperties: { frozenRowCount: 1 },
      },
      data: [buildHeaderRowData(name)],
    })),
  }

  const created = await sheetsRequest<SheetsApiSpreadsheet>(accessToken, '', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  return toWorkspace(created, collectSheetIds(created))
}

/**
 * Carrega os metadados de uma planilha existente e garante que as 5 abas
 * existam (criando as ausentes com seus cabeçalhos).
 */
export async function loadSpreadsheetWorkspace(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetWorkspace> {
  const fields = 'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)'
  const meta = await sheetsRequest<SheetsApiSpreadsheet>(
    accessToken,
    `/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`,
  )

  const ids = collectSheetIds(meta)
  const missing = SHEET_NAMES.filter((name) => !ids.has(name))

  if (missing.length > 0) {
    const added = await addSheets(accessToken, spreadsheetId, missing)
    const addedEntries: { name: SheetName; sheetId: number }[] = []

    for (const name of missing) {
      const sheetId = added.get(name)
      if (sheetId !== undefined) {
        ids.set(name, sheetId)
        addedEntries.push({ name, sheetId })
      }
    }

    if (addedEntries.length > 0) {
      await writeHeaderRows(accessToken, spreadsheetId, addedEntries)
      await formatHeaderRows(
        accessToken,
        spreadsheetId,
        addedEntries.map((entry) => entry.sheetId),
      )
    }
  }

  return toWorkspace(meta, ids)
}

async function addSheets(
  accessToken: string,
  spreadsheetId: string,
  names: readonly SheetName[],
): Promise<Map<SheetName, number>> {
  const requests = names.map((name) => ({ addSheet: { properties: { title: name } } }))

  const response = await sheetsRequest<SheetsApiBatchUpdateResponse>(
    accessToken,
    `/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ requests }) },
  )

  const result = new Map<SheetName, number>()
  response.replies?.forEach((reply, index) => {
    const name = names[index]
    const sheetId = reply.addSheet?.properties.sheetId
    if (name !== undefined && typeof sheetId === 'number') {
      result.set(name, sheetId)
    }
  })
  return result
}

async function writeHeaderRows(
  accessToken: string,
  spreadsheetId: string,
  entries: readonly { name: SheetName }[],
): Promise<void> {
  const data = entries.map(({ name }) => ({
    range: `'${name}'!A1:${columnLetter(SHEET_HEADERS[name].length)}1`,
    majorDimension: 'ROWS',
    values: [SHEET_HEADERS[name].slice()],
  }))

  await sheetsRequest<unknown>(accessToken, `/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  })
}

async function formatHeaderRows(
  accessToken: string,
  spreadsheetId: string,
  sheetIds: readonly number[],
): Promise<void> {
  const requests = sheetIds.flatMap((sheetId) => [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ])

  await sheetsRequest<unknown>(accessToken, `/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  })
}

/**
 * Garante os cabeçalhos do schema nas abas **já existentes** (planilhas criadas
 * antes de uma coluna nova entrar no schema).
 *
 * Estratégia conservadora: escreve apenas o **sufixo** de cabeçalhos que ainda
 * não existe (a partir da última célula preenchida da linha 1), preservando
 * nomes editados pelo usuário e eventuais colunas próprias no fim da aba.
 * Idempotente: quando tudo já está no lugar, não faz nenhuma escrita.
 *
 * Retorna quantas abas tiveram o cabeçalho estendido.
 */
export async function ensureSheetHeaders(
  accessToken: string,
  spreadsheetId: string,
): Promise<number> {
  const ranges = SHEET_NAMES.map(
    (name) => `'${name}'!A1:${columnLetter(SHEET_HEADERS[name].length)}1`,
  )
  const valueRanges = await batchGetValues(accessToken, spreadsheetId, ranges)
  const data: ValueRange[] = []

  valueRanges.forEach((valueRange, index) => {
    const name = SHEET_NAMES[index]
    if (!name) return

    const expected = SHEET_HEADERS[name]
    const atual = (valueRange.values?.[0] ?? []).map((cell) => cellToText(cell))

    let ultimoPreenchido = -1
    for (let column = 0; column < atual.length; column += 1) {
      if (atual[column].length > 0) ultimoPreenchido = column
    }

    if (ultimoPreenchido + 1 >= expected.length) return

    const inicio = ultimoPreenchido + 1
    data.push({
      range: `'${name}'!${columnLetter(inicio + 1)}1:${columnLetter(expected.length)}1`,
      majorDimension: 'ROWS',
      values: [expected.slice(inicio)],
    })
  })

  await batchUpdateValues(accessToken, spreadsheetId, data, 'RAW')
  return data.length
}

/**
 * Garante que todas as abas obrigatórias existam na planilha, criando as
 * ausentes com seus cabeçalhos (idempotente). Também é usada para criar a aba
 * `Valuation` em planilhas mais antigas antes da primeira escrita de análise.
 * Retorna a quantidade de abas criadas.
 */
export async function ensureRequiredSheets(
  accessToken: string,
  spreadsheetId: string,
): Promise<number> {
  const fields = 'sheets.properties(sheetId,title)'
  const meta = await sheetsRequest<SheetsApiSpreadsheet>(
    accessToken,
    `/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`,
  )

  const ids = collectSheetIds(meta)
  const missing = SHEET_NAMES.filter((name) => !ids.has(name))
  if (missing.length === 0) return 0

  const added = await addSheets(accessToken, spreadsheetId, missing)
  const addedEntries: { name: SheetName; sheetId: number }[] = []
  for (const name of missing) {
    const sheetId = added.get(name)
    if (sheetId !== undefined) addedEntries.push({ name, sheetId })
  }

  if (addedEntries.length > 0) {
    await writeHeaderRows(accessToken, spreadsheetId, addedEntries)
    await formatHeaderRows(
      accessToken,
      spreadsheetId,
      addedEntries.map((entry) => entry.sheetId),
    )
  }

  return addedEntries.length
}

/* --------------------------------------------------------------------------
 * API `spreadsheets.values` — leitura/escrita de dados (RF04/RF06, RNF02).
 * ------------------------------------------------------------------------ */

/** Intervalo retornado/escrito na API (`values`). */
export interface ValueRange {
  range: string
  majorDimension?: 'ROWS' | 'COLUMNS'
  values?: CellValue[][]
}

export type ValueInputOption = 'RAW' | 'USER_ENTERED'
export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'

/** Leitura padrão: valores não formatados (números como number, sem `R$`). */
const DEFAULT_RENDER_OPTION: ValueRenderOption = 'UNFORMATTED_VALUE'

interface ValuesResponse {
  range?: string
  majorDimension?: 'ROWS' | 'COLUMNS'
  values?: CellValue[][]
}

interface BatchGetValuesResponse {
  valueRanges?: ValuesResponse[]
}

function valuesPath(spreadsheetId: string, suffix: string): string {
  return `/${encodeURIComponent(spreadsheetId)}/values${suffix}`
}

/** Lê um intervalo (`spreadsheets.values.get`). */
export async function getValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  renderOption: ValueRenderOption = DEFAULT_RENDER_OPTION,
): Promise<CellValue[][]> {
  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: renderOption })
  const response = await sheetsRequest<ValuesResponse>(
    accessToken,
    `${valuesPath(spreadsheetId, `/${encodeURIComponent(range)}`)}?${query.toString()}`,
  )
  return response.values ?? []
}

/** Lê vários intervalos em uma única chamada (`spreadsheets.values.batchGet`). */
export async function batchGetValues(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
  renderOption: ValueRenderOption = DEFAULT_RENDER_OPTION,
): Promise<ValueRange[]> {
  if (ranges.length === 0) return []

  const query = new URLSearchParams({ valueRenderOption: renderOption })
  for (const range of ranges) query.append('ranges', range)

  const response = await sheetsRequest<BatchGetValuesResponse>(
    accessToken,
    `${valuesPath(spreadsheetId, ':batchGet')}?${query.toString()}`,
  )

  return (response.valueRanges ?? []).map((valueRange, index) => ({
    range: valueRange.range ?? ranges[index] ?? '',
    majorDimension: valueRange.majorDimension,
    values: valueRange.values ?? [],
  }))
}

/** Escreve valores em um intervalo (`spreadsheets.values.update`). */
export async function updateValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption: ValueInputOption = 'RAW',
): Promise<void> {
  const query = new URLSearchParams({ valueInputOption: inputOption })
  await sheetsRequest<unknown>(
    accessToken,
    `${valuesPath(spreadsheetId, `/${encodeURIComponent(range)}`)}?${query.toString()}`,
    { method: 'PUT', body: JSON.stringify({ majorDimension: 'ROWS', values }) },
  )
}

/** Escreve vários intervalos em uma única chamada (`spreadsheets.values.batchUpdate`). */
export async function batchUpdateValues(
  accessToken: string,
  spreadsheetId: string,
  data: readonly ValueRange[],
  inputOption: ValueInputOption = 'RAW',
): Promise<void> {
  if (data.length === 0) return
  await sheetsRequest<unknown>(accessToken, valuesPath(spreadsheetId, ':batchUpdate'), {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: inputOption, data }),
  })
}

/** Acrescenta linhas ao final da tabela (`spreadsheets.values.append`). */
export async function appendValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption: ValueInputOption = 'RAW',
): Promise<void> {
  const query = new URLSearchParams({
    valueInputOption: inputOption,
    insertDataOption: 'INSERT_ROWS',
  })
  await sheetsRequest<unknown>(
    accessToken,
    `${valuesPath(spreadsheetId, `/${encodeURIComponent(range)}:append`)}?${query.toString()}`,
    { method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values }) },
  )
}

/**
 * Limpa **apenas os valores** de um intervalo (`spreadsheets.values.clear`),
 * preservando formatação e as colunas fora do intervalo (ex.: fórmulas do
 * `Consolidado`).
 */
export async function clearValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  await sheetsRequest<unknown>(
    accessToken,
    valuesPath(spreadsheetId, `/${encodeURIComponent(range)}:clear`),
    { method: 'POST' },
  )
}
