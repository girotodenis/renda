import {
  clearStorageKeys,
  listStorageKeys,
  readStorageJson,
  removeStorageKey,
  writeStorageJson,
} from '@/lib/storage'
import type { SheetName } from '@/lib/sheetsSchema'

/**
 * Cache local das abas da planilha (RNF02).
 *
 * Estratégia: **leitura sempre do cache primeiro**; o cache é invalidado apenas
 * em ações de escrita ou refresh explícito. Isso minimiza as chamadas à API do
 * Google (RNF02) e permite leitura offline do último estado (RNF08).
 */

/** Versão do formato de cache — incremente ao mudar o schema das entidades. */
const CACHE_VERSION = 'v1'
const CACHE_PREFIX = `minhaacoes.cache.${CACHE_VERSION}.`

/** Registro persistido de uma aba. */
export interface CacheRecord<T> {
  spreadsheetId: string
  sheetName: SheetName
  /** ISO 8601 do momento em que a aba foi lida/atualizada. */
  updatedAt: string
  rows: T[]
}

function cacheKey(spreadsheetId: string, sheetName: SheetName): string {
  return `${CACHE_PREFIX}${spreadsheetId}.${sheetName}`
}

function spreadsheetPrefix(spreadsheetId: string): string {
  return `${CACHE_PREFIX}${spreadsheetId}.`
}

/** Lê o cache de uma aba (`null` quando ausente/inválido → dispara nova busca). */
export function readSheetCache<T>(spreadsheetId: string, sheetName: SheetName): CacheRecord<T> | null {
  const record = readStorageJson<CacheRecord<T>>(cacheKey(spreadsheetId, sheetName))
  if (!record || !Array.isArray(record.rows)) return null
  return record
}

/** Grava o cache de uma aba com o timestamp atual. */
export function writeSheetCache<T>(
  spreadsheetId: string,
  sheetName: SheetName,
  rows: readonly T[],
): CacheRecord<T> {
  const record: CacheRecord<T> = {
    spreadsheetId,
    sheetName,
    updatedAt: new Date().toISOString(),
    rows: rows.slice(),
  }
  writeStorageJson(cacheKey(spreadsheetId, sheetName), record)
  return record
}

/** Invalida o cache de uma aba (chamado após escrita). */
export function invalidateSheetCache(spreadsheetId: string, sheetName: SheetName): void {
  removeStorageKey(cacheKey(spreadsheetId, sheetName))
}

/** Invalida o cache de todas as abas de uma planilha. */
export function invalidateSpreadsheetCache(spreadsheetId: string): void {
  clearStorageKeys(spreadsheetPrefix(spreadsheetId))
}

/** Remove todo o cache de dados do app (logout/refresh explícito global). */
export function clearAllSheetCache(): number {
  return clearStorageKeys(CACHE_PREFIX)
}

/** Lista as planilhas com dados em cache (útil no diagnóstico). */
export function listCachedSpreadsheets(): string[] {
  const ids = new Set<string>()
  for (const key of listStorageKeys(CACHE_PREFIX)) {
    const remainder = key.slice(CACHE_PREFIX.length)
    const separator = remainder.indexOf('.')
    if (separator > 0) ids.add(remainder.slice(0, separator))
  }
  return [...ids]
}
