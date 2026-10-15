import { criarWorkspaceLocal } from '@/domain/armazenamento'
import type { SpreadsheetWorkspace } from '@/domain/workspace'
import type { ValueRange } from '@/infrastructure/sheets/gateway'
import { parseA1Range } from '@/infrastructure/sheets/a1'
import {
  appendValuesToSheet,
  clearSheetRange,
  ensureLocalSheetsWithHeaders,
  readSheetRange,
  writeSheetRange,
} from '@/infrastructure/sheets/localSheets'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Adaptador local da "planilha" (RF02) — mesma superfície usada pelos
 * repositórios, mas servida pelo IndexedDB em vez da API do Google.
 *
 * Só existem aqui as operações de **valores** necessárias aos repositórios;
 * metadados remotos (locale, pasta do Drive, Picker) não fazem sentido sem rede.
 * Nenhuma função lança: o armazenamento local é síncrono e sempre disponível.
 */

/** Lê um intervalo (`spreadsheets.values.get`). */
export async function localGetValues(range: string): Promise<CellValue[][]> {
  const address = parseA1Range(range)
  if (!address) return []
  return readSheetRange(address.sheetName, address)
}

/** Lê vários intervalos em uma única chamada (`spreadsheets.values.batchGet`). */
export async function localBatchGetValues(ranges: readonly string[]): Promise<ValueRange[]> {
  const result: ValueRange[] = []
  for (const range of ranges) {
    result.push({ range, majorDimension: 'ROWS', values: await localGetValues(range) })
  }
  return result
}

/** Escreve valores em um intervalo (`spreadsheets.values.update`). */
export async function localUpdateValues(
  range: string,
  values: readonly (readonly CellValue[])[],
): Promise<void> {
  const address = parseA1Range(range)
  if (!address) return
  writeSheetRange(address.sheetName, address, values)
}

/** Escreve vários intervalos (`spreadsheets.values.batchUpdate`). */
export async function localBatchUpdateValues(data: readonly ValueRange[]): Promise<void> {
  for (const valueRange of data) {
    await localUpdateValues(valueRange.range, valueRange.values ?? [])
  }
}

/** Acrescenta linhas ao final da tabela (`spreadsheets.values.append`). */
export async function localAppendValues(
  range: string,
  values: readonly (readonly CellValue[])[],
): Promise<void> {
  const address = parseA1Range(range)
  if (!address) return
  appendValuesToSheet(address.sheetName, address, values)
}

/** Limpa as células de um intervalo (`spreadsheets.values.clear`). */
export async function localClearValues(range: string): Promise<void> {
  const address = parseA1Range(range)
  if (!address) return
  clearSheetRange(address.sheetName, address)
}

/**
 * Garante que todas as abas do schema existam no banco local (idempotente).
 * Devolve quantas abas foram criadas — mesmo contrato de
 * `ensureRequiredSheets` (Google).
 */
export async function localEnsureRequiredSheets(): Promise<number> {
  return ensureLocalSheetsWithHeaders()
}

/**
 * Carrega o workspace local (garantindo as abas). No modo local não existe
 * planilha remota: as abas já vivem no IndexedDB, então isto é o equivalente
 * local de `loadSpreadsheetWorkspace`/`createDefaultSpreadsheet`.
 */
export async function localLoadWorkspace(updatedAt: string): Promise<SpreadsheetWorkspace> {
  ensureLocalSheetsWithHeaders()
  return criarWorkspaceLocal(updatedAt)
}

/** Locale fixo do modo local (define o separador de fórmulas, se houver). */
export const LOCAL_SHEET_LOCALE = 'pt_BR'
