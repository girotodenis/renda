import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import type { EnderecoA1 } from '@/infrastructure/sheets/a1'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { kvDelete, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'

/**
 * "Planilha" local do modo sem Google (RF02).
 *
 * Guarda a **matriz bruta de células** (`CellValue[][]`, com a linha 1 de
 * cabeçalho) de cada aba no IndexedDB, no mesmo *key-value store* usado pelo
 * cache de abas — mas em um namespace próprio (`local-sheet::<aba>`), que não
 * colide com as chaves do cache (`<spreadsheetId>.<aba>`).
 *
 * Guardar valores brutos (e não entidades já decodificadas) é o que permite:
 * - reusar os mesmos repositórios/codecs do modo Google, sem duplicar lógica;
 * - exportar o arquivo `.ods` exatamente com o que o usuário vê.
 */

const KEY_PREFIX = 'local-sheet::'

function keyFor(sheetName: string): string {
  return `${KEY_PREFIX}${sheetName}`
}

/** Matriz de células de uma aba (linha 1 = cabeçalho). */
export type SheetMatrix = CellValue[][]

function isEmptyCell(cell: CellValue | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim().length === 0)
}

function isEmptyRow(row: readonly CellValue[] | undefined): boolean {
  return !row || row.every((cell) => isEmptyCell(cell))
}

/** Remove linhas vazias no fim (mantém a matriz canônica e o `.ods` limpo). */
function trimTrailingEmptyRows(rows: SheetMatrix): SheetMatrix {
  let end = rows.length
  while (end > 0 && isEmptyRow(rows[end - 1])) end -= 1
  return rows.slice(0, end)
}

function copyMatrix(rows: SheetMatrix): SheetMatrix {
  return rows.map((row) => row.slice())
}

/** Lê a matriz completa de uma aba (`[]` quando a aba ainda não tem dados). */
export function readLocalSheet(sheetName: string): SheetMatrix {
  const values = kvGet<SheetMatrix>('sheets', keyFor(sheetName))
  return Array.isArray(values) ? values : []
}

/** Grava a matriz completa de uma aba. */
export function writeLocalSheet(sheetName: string, values: SheetMatrix): void {
  kvSet('sheets', keyFor(sheetName), trimTrailingEmptyRows(copyMatrix(values)))
}

/** Lista as abas com dados no banco local. */
export function listLocalSheetNames(): string[] {
  return kvKeys('sheets')
    .filter((key) => key.startsWith(KEY_PREFIX))
    .map((key) => key.slice(KEY_PREFIX.length))
}

/** Remove todas as abas locais (usado no logout/limpeza explícita). */
export function clearLocalSheets(): string[] {
  const keys = kvKeys('sheets').filter((key) => key.startsWith(KEY_PREFIX))
  for (const key of keys) kvDelete('sheets', key)
  return keys.map((key) => key.slice(KEY_PREFIX.length))
}

/**
 * Cria as abas ausentes com a linha de cabeçalho do schema e completa os
 * cabeçalhos que faltam em abas já existentes (migração de colunas novas).
 * Devolve quantas abas foram criadas ou atualizadas.
 */
export function ensureLocalSheetsWithHeaders(): number {
  let atualizadas = 0
  for (const name of SHEET_NAMES) {
    const headers = SHEET_HEADERS[name]
    const rows = readLocalSheet(name)

    if (rows.length === 0) {
      writeLocalSheet(name, [[...headers]])
      atualizadas += 1
      continue
    }

    const atual = rows[0] ?? []
    let ultimoPreenchido = -1
    for (let column = 0; column < atual.length; column += 1) {
      if (!isEmptyCell(atual[column])) ultimoPreenchido = column
    }
    if (ultimoPreenchido + 1 >= headers.length) continue

    const next = copyMatrix(rows)
    const cabecalho = next[0] ?? []
    for (let column = ultimoPreenchido + 1; column < headers.length; column += 1) {
      cabecalho[column] = headers[column]
    }
    next[0] = cabecalho
    writeLocalSheet(name, next)
    atualizadas += 1
  }
  return atualizadas
}

/** Recorta o intervalo pedido da matriz (linhas e colunas, sem padding). */
export function readSheetRange(sheetName: string, address: EnderecoA1): SheetMatrix {
  const rows = readLocalSheet(sheetName)
  const end = address.endRow === null ? rows.length : address.endRow + 1
  const selected = rows
    .slice(address.startRow, end)
    .map((row) => row.slice(address.startColumn, address.endColumn + 1))
  return trimTrailingEmptyRows(selected)
}

/** Escreve `values` a partir da célula inicial do intervalo (crescendo a matriz). */
export function writeSheetRange(
  sheetName: string,
  address: EnderecoA1,
  values: readonly (readonly CellValue[])[],
): void {
  const rows = copyMatrix(readLocalSheet(sheetName))

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

  writeLocalSheet(sheetName, rows)
}

/**
 * Acrescenta linhas ao final da tabela existente (`values.append`).
 *
 * Mesma semântica do Google: encontra a última linha com conteúdo a partir da
 * linha inicial do intervalo e escreve logo depois dela.
 */
export function appendValuesToSheet(
  sheetName: string,
  address: EnderecoA1,
  values: readonly (readonly CellValue[])[],
): void {
  const rows = readLocalSheet(sheetName)
  let lastContentRow = address.startRow - 1
  for (let index = address.startRow; index < rows.length; index += 1) {
    if (!isEmptyRow(rows[index])) lastContentRow = index
  }
  writeSheetRange(sheetName, { ...address, startRow: lastContentRow + 1 }, values)
}

/** Limpa (zera) as células do intervalo, preservando o resto da aba. */
export function clearSheetRange(sheetName: string, address: EnderecoA1): void {
  const rows = copyMatrix(readLocalSheet(sheetName))
  const lastRow = address.endRow === null ? rows.length - 1 : Math.min(address.endRow, rows.length - 1)

  for (let rowIndex = address.startRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row) continue
    for (let column = address.startColumn; column <= address.endColumn; column += 1) {
      if (column < row.length) row[column] = null
    }
  }

  writeLocalSheet(sheetName, rows)
}

/** Nomes canônicos das abas na ordem do schema (para a exportação). */
export function localSheetNames(): readonly SheetName[] {
  return SHEET_NAMES
}
