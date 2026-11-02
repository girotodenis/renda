import { criarWorkspaceLocal } from '@/domain/armazenamento'
import type { SpreadsheetWorkspace } from '@/domain/workspace'
import type { ValueRange } from '@/infrastructure/sheets/gateway'
import { parseA1Range } from '@/infrastructure/sheets/a1'
import { temChave } from '@/infrastructure/cripto/chaveSessao'
import { ID_COFRE_LOCAL, temCofreLocal } from '@/infrastructure/cripto/localCofre'
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
 *
 * A superfície já era assíncrona (mesmo contrato do gateway do Google), mas o
 * armazenamento local respondia de forma síncrona. Com o cofre local (Fase 6) a
 * decifra é real, então estas funções agora **aguardam** a leitura/escrita —
 * e propagam `ChaveNecessariaError` quando o banco está cifrado e bloqueado.
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
  await writeSheetRange(address.sheetName, address, values)
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
  await appendValuesToSheet(address.sheetName, address, values)
}

/** Limpa as células de um intervalo (`spreadsheets.values.clear`). */
export async function localClearValues(range: string): Promise<void> {
  const address = parseA1Range(range)
  if (!address) return
  await clearSheetRange(address.sheetName, address)
}

/**
 * Garante os cabeçalhos do schema nas abas locais já existentes (idempotente).
 * Equivalente local de `ensureSheetHeaders` (Google).
 */
export async function localEnsureSheetHeaders(): Promise<number> {
  return ensureLocalSheetsWithHeaders()
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
  const cifrado = temCofreLocal()
  // Cofre ativo e sessão bloqueada: não se garante cabeçalho nenhum (gravar
  // exigiria a chave). O workspace só reporta o estado — as leituras e escritas
  // é que lançam `ChaveNecessariaError`.
  if (!cifrado || temChave(ID_COFRE_LOCAL)) await ensureLocalSheetsWithHeaders()

  return {
    ...criarWorkspaceLocal(updatedAt),
    // O workspace local não pode perder a marca de cifra ao ser reaberto.
    criptografia: cifrado ? 'total' : 'nenhuma',
  }
}

/** Locale fixo do modo local (define o separador de fórmulas, se houver). */
export const LOCAL_SHEET_LOCALE = 'pt_BR'
