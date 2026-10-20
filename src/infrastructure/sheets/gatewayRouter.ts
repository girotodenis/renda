import type { SheetName } from '@/domain/sheetsSchema'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { RepositoryContext } from '@/domain/repositories/ports'
import type { SpreadsheetWorkspace } from '@/domain/workspace'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import * as google from '@/infrastructure/sheets/gateway'
import type { ValueInputOption, ValueRange, ValueRenderOption } from '@/infrastructure/sheets/gateway'
import * as local from '@/infrastructure/sheets/localGateway'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Roteador de origem de dados (RF01/RF02) — a única decisão "google vs. local"
 * do app.
 *
 * Expõe **a mesma superfície** do gateway do Google Sheets e escolhe o
 * adaptador pelo modo ativo. Assim, repositórios e casos de uso permanecem
 * agnósticos à origem: nenhum deles conhece `isModoLocal()`.
 *
 * Erros e utilitários puros continuam sendo reexportados do gateway remoto
 * (não há equivalente local: o IndexedDB não falha por rede/quota).
 *
 * Os adaptadores são importados por **namespace** para que as funções deste
 * módulo possam ter os mesmos nomes das originais sem recursão acidental.
 */

export {
  columnLetter,
  describeSheetsError,
  getSheetsRequestCount,
  isQuotaError,
  resetSheetsRequestCount,
  SheetsApiError,
} from '@/infrastructure/sheets/gateway'
export type {
  ValueInputOption,
  ValueRange,
  ValueRenderOption,
} from '@/infrastructure/sheets/gateway'

/** Lê um intervalo de uma aba na origem ativa. */
export function getValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  renderOption?: ValueRenderOption,
): Promise<CellValue[][]> {
  if (isModoLocal()) return local.localGetValues(range)
  return google.getValues(accessToken, spreadsheetId, range, renderOption)
}

/** Lê vários intervalos na origem ativa (uma chamada no modo Google). */
export function batchGetValues(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
  renderOption?: ValueRenderOption,
): Promise<ValueRange[]> {
  if (isModoLocal()) return local.localBatchGetValues(ranges)
  return google.batchGetValues(accessToken, spreadsheetId, ranges, renderOption)
}

/** Escreve um intervalo na origem ativa. */
export function updateValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption?: ValueInputOption,
): Promise<void> {
  if (isModoLocal()) return local.localUpdateValues(range, values)
  return google.updateValues(accessToken, spreadsheetId, range, values, inputOption)
}

/** Escreve vários intervalos na origem ativa. */
export function batchUpdateValues(
  accessToken: string,
  spreadsheetId: string,
  data: readonly ValueRange[],
  inputOption?: ValueInputOption,
): Promise<void> {
  if (isModoLocal()) return local.localBatchUpdateValues(data)
  return google.batchUpdateValues(accessToken, spreadsheetId, data, inputOption)
}

/** Acrescenta linhas ao final da tabela na origem ativa. */
export function appendValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption?: ValueInputOption,
): Promise<void> {
  if (isModoLocal()) return local.localAppendValues(range, values)
  return google.appendValues(accessToken, spreadsheetId, range, values, inputOption)
}

/** Limpa as células de um intervalo na origem ativa. */
export function clearValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  if (isModoLocal()) return local.localClearValues(range)
  return google.clearValues(accessToken, spreadsheetId, range)
}

/**
 * Locale da "planilha" ativa — define o separador das fórmulas. No modo local
 * não há API: usa-se `pt_BR` (o `.ods` exportado também é pt-BR).
 */
export function getSpreadsheetLocale(
  accessToken: string,
  spreadsheetId: string,
  options?: { forceRefresh?: boolean },
): Promise<string | null> {
  if (isModoLocal()) return Promise.resolve(local.LOCAL_SHEET_LOCALE)
  return google.getSpreadsheetLocale(accessToken, spreadsheetId, options)
}

/** Garante as abas obrigatórias na origem ativa (criação é local no modo local). */
export function ensureRequiredSheets(accessToken: string, spreadsheetId: string): Promise<number> {
  if (isModoLocal()) return local.localEnsureRequiredSheets()
  return google.ensureRequiredSheets(accessToken, spreadsheetId)
}

/**
 * Garante os cabeçalhos do schema nas abas já existentes (migração de colunas
 * novas em planilhas antigas). No modo local apenas completa a matriz do
 * IndexedDB, sem rede.
 */
export function ensureSheetHeaders(accessToken: string, spreadsheetId: string): Promise<number> {
  if (isModoLocal()) return local.localEnsureSheetHeaders()
  return google.ensureSheetHeaders(accessToken, spreadsheetId)
}

/** Cria o workspace inicial da origem ativa (7 abas + cabeçalhos, RF02). */
export function criarWorkspace(
  accessToken: string,
  title?: string,
): Promise<SpreadsheetWorkspace> {
  if (isModoLocal()) return local.localLoadWorkspace(new Date().toISOString())
  return google.createDefaultSpreadsheet(accessToken, title)
}

/**
 * Prepara (cria ou reabre) o workspace local do modo sem Google.
 * Idempotente: preserva o que já está no banco do navegador.
 */
export function prepararWorkspaceLocal(): Promise<SpreadsheetWorkspace> {
  return local.localLoadWorkspace(new Date().toISOString())
}

/** Carrega o workspace existente da origem ativa (garantindo as abas). */
export function abrirWorkspace(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetWorkspace> {
  if (isModoLocal()) return local.localLoadWorkspace(new Date().toISOString())
  return google.loadSpreadsheetWorkspace(accessToken, spreadsheetId)
}

/** Uma aba pronta para exportação (cabeçalho + dados). */
export interface AbaExportada {
  nome: SheetName
  valores: CellValue[][]
}

/** Intervalo A1 completo de uma aba do schema (todas as colunas). */
export function rangeCompletoDaAba(nome: SheetName): string {
  return `'${nome}'!A1:${google.columnLetter(SHEET_HEADERS[nome].length)}`
}

/**
 * Lê todas as abas do schema (cabeçalho + dados) para gerar o arquivo `.ods`.
 * No modo Google usa um único `batchGet`; no modo local, o IndexedDB.
 */
export async function lerAbasParaExportacao(
  context: RepositoryContext,
): Promise<AbaExportada[]> {
  const ranges = SHEET_NAMES.map((nome) => rangeCompletoDaAba(nome))
  const valueRanges = await batchGetValues(context.accessToken, context.spreadsheetId, ranges)

  return SHEET_NAMES.map((nome, index) => ({
    nome,
    valores: valueRanges[index]?.values ?? [],
  }))
}
