import { fromCentavos, round2, toCentavos } from '@/domain/money'

/**
 * Conversão de células da planilha ↔ valores tipados do domínio.
 *
 * A API do Sheets devolve, com `UNFORMATTED_VALUE`, números para células
 * numéricas e strings para texto. Estes helpers normalizam também entradas
 * manuais (ex.: `"R$ 1.234,56"`, `"1.234,56"`, datas `DD/MM/AAAA`).
 */

export type CellValue = string | number | boolean | null

const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/
const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})/

function isBlankCell(value: CellValue): boolean {
  return value === null || (typeof value === 'string' && value.trim().length === 0)
}

/** Converte uma célula em texto (células vazias → `fallback`). */
export function cellToText(value: CellValue, fallback = ''): string {
  if (value === null) return fallback
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : fallback
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/[^0-9.,-]/g, '')
  if (cleaned.length === 0) return null

  const hasComma = cleaned.includes(',')
  const hasDot = cleaned.includes('.')
  let normalized = cleaned

  if (hasComma && hasDot) {
    // Formato pt-BR: '.' milhar, ',' decimal.
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.')
  }

  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

/** Converte uma célula em número (células vazias/ inválidas → `fallback`). */
export function cellToNumber(value: CellValue, fallback = 0): number {
  if (value === null) return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value.trim().length === 0) return fallback
  return parseDecimal(value) ?? fallback
}

/** Converte uma célula em número opcional (`null` quando vazia). */
export function cellToOptionalNumber(value: CellValue): number | null {
  return isBlankCell(value) ? null : cellToNumber(value)
}

/** Converte uma célula monetária (em reais) para **centavos inteiros**. */
export function cellToCentavos(value: CellValue, fallback = 0): number {
  const reais = cellToNumber(value, Number.NaN)
  return Number.isFinite(reais) ? toCentavos(reais) : fallback
}

/** Converte uma célula monetária opcional para **centavos** (`null` quando vazia). */
export function cellToOptionalCentavos(value: CellValue): number | null {
  return isBlankCell(value) ? null : toCentavos(cellToNumber(value))
}

function isoFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const date = new Date(SHEETS_EPOCH_UTC_MS + Math.round(serial) * MS_PER_DAY)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Converte uma célula de data em ISO `YYYY-MM-DD` (aceita serial, ISO e BR). */
export function cellToIsoDate(value: CellValue): string | null {
  if (value === null) return null
  if (typeof value === 'number') return isoFromSerial(value)
  if (typeof value === 'boolean') return null

  const text = value.trim()
  if (text.length === 0) return null

  const iso = ISO_DATE.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const br = BR_DATE.exec(text)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`

  return null
}

/** Serializa centavos para o número em reais gravado na planilha. */
export function centavosToCell(centavos: number): number {
  return fromCentavos(round2(centavos))
}

/** Serializa centavos opcionais (vazios → `''`). */
export function optionalCentavosToCell(centavos: number | null): CellValue {
  return centavos === null ? '' : centavosToCell(centavos)
}

/** Normaliza um valor de domínio para uma célula gravável (`undefined` → `''`). */
export function toCell(value: CellValue | undefined): CellValue {
  return value === undefined ? '' : value
}
