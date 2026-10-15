/**
 * Leitura de endereços A1 (`'Operacoes'!A2:L`) usada pelo adaptador local.
 *
 * A API do Google Sheets interpreta a notação A1 no servidor; o adaptador local
 * precisa da mesma interpretação para aplicar leituras/escritas de intervalo em
 * uma matriz de células (`CellValue[][]`) guardada no IndexedDB.
 *
 * Escopo deliberadamente pequeno — apenas o que os repositórios geram:
 * `'Aba'!A1`, `'Aba'!A1:L`, `'Aba'!A2:L`, `'Aba'!A2:L10`, `'Aba'!A1:L1`.
 */

/** Endereço de intervalo já traduzido para índices 0-based. */
export interface EnderecoA1 {
  /** Nome da aba (sem aspas). Vazio quando o intervalo não traz o nome. */
  sheetName: string
  /** Primeira linha (0-based). */
  startRow: number
  /** Primeira coluna (0-based). */
  startColumn: number
  /** Última linha (0-based) ou `null` quando o intervalo é aberto (`A2:L`). */
  endRow: number | null
  /** Última coluna (0-based). */
  endColumn: number
}

interface CelulaA1 {
  row: number | null
  column: number | null
}

const CELULA_A1 = /^([A-Za-z]{1,3})?(\d{1,7})?$/

/** Converte letras de coluna (`A`, `L`, `AB`) no índice 0-based. */
export function columnIndexFromLetters(letters: string): number {
  let index = 0
  for (const character of letters.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index - 1
}

/** Remove as aspas simples de um nome de aba (`'Metas_Rebalanceamento'`). */
function unquoteSheetName(sheetName: string): string {
  const trimmed = sheetName.trim()
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

function parseCelula(text: string): CelulaA1 | null {
  const match = CELULA_A1.exec(text.trim())
  if (!match) return null
  const [, letters, digits] = match
  if (!letters && !digits) return null
  return {
    row: digits ? Number(digits) - 1 : null,
    column: letters ? columnIndexFromLetters(letters) : null,
  }
}

/**
 * Traduz um endereço A1 em índices 0-based. Devolve `null` quando o endereço é
 * inválido ou não tem coluna/linha inicial (casos que o app nunca gera).
 */
export function parseA1Range(range: string): EnderecoA1 | null {
  const trimmed = range.trim()
  if (trimmed.length === 0) return null

  const separator = trimmed.lastIndexOf('!')
  const sheetName = separator >= 0 ? unquoteSheetName(trimmed.slice(0, separator)) : ''
  const cells = separator >= 0 ? trimmed.slice(separator + 1) : trimmed

  const [startText = '', endText] = cells.split(':')
  const start = parseCelula(startText)
  if (!start || start.column === null || start.row === null) return null

  const end = endText === undefined ? start : parseCelula(endText)
  if (!end) return null

  const endColumn = end.column ?? start.column
  if (endColumn < start.column) return null
  if (end.row !== null && end.row < start.row) return null

  return {
    sheetName,
    startRow: start.row,
    startColumn: start.column,
    endRow: end.row,
    endColumn,
  }
}
