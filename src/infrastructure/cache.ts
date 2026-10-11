import type { SheetName } from '@/domain/sheetsSchema'
import { kvClear, kvDelete, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'

/**
 * Cache local das abas da planilha (RNF02), agora persistido no IndexedDB
 * (Fase 5) com espelho em memória para leitura síncrona.
 *
 * Estratégia: **leitura sempre do cache primeiro**; o cache é invalidado apenas
 * em ações de escrita ou refresh explícito. Isso minimiza as chamadas à API do
 * Google (RNF02) e permite leitura offline do último estado (RNF08).
 *
 * As chaves na object store `sheets` são `${spreadsheetId}.${sheetName}`.
 */

/** Registro persistido de uma aba. */
export interface CacheRecord<T> {
  spreadsheetId: string
  sheetName: SheetName
  /** ISO 8601 do momento em que a aba foi lida/atualizada. */
  updatedAt: string
  rows: T[]
}

const KEY_SEPARATOR = '.'

function cacheKey(spreadsheetId: string, sheetName: SheetName): string {
  return `${spreadsheetId}${KEY_SEPARATOR}${sheetName}`
}

function spreadsheetPrefix(spreadsheetId: string): string {
  return `${spreadsheetId}${KEY_SEPARATOR}`
}

/** Lê o cache de uma aba (`null` quando ausente/inválido → dispara nova busca). */
export function readSheetCache<T>(spreadsheetId: string, sheetName: SheetName): CacheRecord<T> | null {
  const record = kvGet<CacheRecord<T>>('sheets', cacheKey(spreadsheetId, sheetName))
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
  kvSet('sheets', cacheKey(spreadsheetId, sheetName), record)
  return record
}

/** Invalida o cache de uma aba (chamado após escrita). */
export function invalidateSheetCache(spreadsheetId: string, sheetName: SheetName): void {
  kvDelete('sheets', cacheKey(spreadsheetId, sheetName))
}

/** Invalida o cache de todas as abas de uma planilha. */
export function invalidateSpreadsheetCache(spreadsheetId: string): void {
  const prefix = spreadsheetPrefix(spreadsheetId)
  for (const key of kvKeys('sheets')) {
    if (key.startsWith(prefix)) kvDelete('sheets', key)
  }
}

/** Remove todo o cache de dados do app (logout/refresh explícito global). */
export function clearAllSheetCache(): number {
  const keys = kvKeys('sheets')
  kvClear('sheets')
  return keys.length
}

/** Lista as planilhas com dados em cache (útil no diagnóstico). */
export function listCachedSpreadsheets(): string[] {
  const ids = new Set<string>()
  for (const key of kvKeys('sheets')) {
    const separator = key.indexOf(KEY_SEPARATOR)
    if (separator > 0) ids.add(key.slice(0, separator))
  }
  return [...ids]
}
