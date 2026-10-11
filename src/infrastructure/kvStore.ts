/**
 * Espelho em memória + persistência assíncrona no IndexedDB (Fase 5).
 *
 * O contrato de domínio exige leitura **síncrona** (`Repository.readCache` →
 * `T[] | null`, `temCacheCompleto`, `lerDashboardDoCache`). Para preservá-lo,
 * este módulo mantém um espelho em memória de cada object store:
 *
 * 1. `ensureHydrated()` — lê tudo do IndexedDB para o espelho (uma única vez);
 * 2. leituras síncronas leem do espelho;
 * 3. escritas atualizam o espelho de forma síncrona e persistem no IndexedDB de
 *    forma assíncrona (fire-and-forget, com `catch`);
 * 4. `main.tsx` bloqueia o render até a hidratação terminar (catch → segue com
 *    o espelho vazio em caso de falha).
 *
 * Também realiza a MIGRAÇÃO ÚNICA do `localStorage` (formato das Fases 0–4)
 * para o IndexedDB: se o IndexedDB estiver vazio e o `localStorage` tiver as
 * chaves antigas (`minhaacoes.cache.v1.*` e `minhaacoes.outbox.v1`), importa
 * os dados para o IndexedDB e depois limpa essas chaves.
 */

import { getBackend } from '@/infrastructure/db'
import type { StoreName } from '@/infrastructure/db'
import {
  listStorageKeys,
  readStorageJson,
  removeStorageKey,
} from '@/infrastructure/storage'

/** Chaves legadas no `localStorage` (formato das Fases 0–4). */
const LEGACY_CACHE_PREFIX = 'minhaacoes.cache.v1.'
const LEGACY_OUTBOX_KEY = 'minhaacoes.outbox.v1'

const STORES: readonly StoreName[] = ['sheets', 'outbox']

const mirrors: Record<StoreName, Map<string, unknown>> = {
  sheets: new Map(),
  outbox: new Map(),
}

let hydrated = false
let hydrationPromise: Promise<void> | null = null

/** Forma mínima de um registro de cache legado (apenas o necessário p/ migrar). */
interface LegacyCacheRecord {
  spreadsheetId?: unknown
  sheetName?: unknown
  rows?: unknown
}

function mirror(store: StoreName): Map<string, unknown> {
  return mirrors[store]
}

/** Persistência assíncrona best-effort (nunca lança para o chamador síncrono). */
function persist(store: StoreName, key: string, value: unknown): void {
  void (async () => {
    try {
      await getBackend().put(store, key, value)
    } catch {
      // O espelho em memória já tem o valor; a persistência é melhor esforço.
    }
  })()
}

function persistDelete(store: StoreName, key: string): void {
  void (async () => {
    try {
      await getBackend().delete(store, key)
    } catch {
      // Melhor esforço.
    }
  })()
}

function persistClear(store: StoreName): void {
  void (async () => {
    try {
      await getBackend().clear(store)
    } catch {
      // Melhor esforço.
    }
  })()
}

/** Importa os dados legados do `localStorage` para o IndexedDB (uma única vez). */
async function migrateFromLocalStorage(): Promise<void> {
  const backend = getBackend()
  if (!backend.available()) return

  // Só migra se o IndexedDB estiver **vazio** — senão ele já é a fonte da
  // verdade e os dados antigos do localStorage devem ser ignorados.
  const [sheetsRows, outboxRows] = await Promise.all([
    backend.getAll('sheets'),
    backend.getAll('outbox'),
  ])
  if (sheetsRows.length > 0 || outboxRows.length > 0) return

  const pendingPuts: Array<Promise<void>> = []
  const keysToRemove: string[] = []

  // 1. Cache de abas: `minhaacoes.cache.v1.<spreadsheetId>.<sheetName>`.
  //    A chave no IndexedDB é apenas `<spreadsheetId>.<sheetName>`.
  for (const storageKey of listStorageKeys(LEGACY_CACHE_PREFIX)) {
    const record = readStorageJson<LegacyCacheRecord>(storageKey)
    if (
      !record ||
      typeof record.spreadsheetId !== 'string' ||
      typeof record.sheetName !== 'string' ||
      !Array.isArray(record.rows)
    ) {
      continue
    }
    const idbKey = storageKey.slice(LEGACY_CACHE_PREFIX.length)
    if (idbKey.length === 0) continue
    pendingPuts.push(backend.put('sheets', idbKey, record))
    keysToRemove.push(storageKey)
  }

  // 2. Outbox: `minhaacoes.outbox.v1` (array de mutações), uma entrada por
  //    mutação, chaveada por `mutation.id`.
  const legacyOutbox = readStorageJson<unknown>(LEGACY_OUTBOX_KEY)
  if (Array.isArray(legacyOutbox)) {
    for (const mutation of legacyOutbox) {
      if (typeof mutation !== 'object' || mutation === null) continue
      const id = (mutation as { id?: unknown }).id
      if (typeof id !== 'string' || id.length === 0) continue
      pendingPuts.push(backend.put('outbox', id, mutation))
    }
    keysToRemove.push(LEGACY_OUTBOX_KEY)
  }

  // Importa primeiro; só depois limpa o localStorage (evita perda se a
  // importação falhar no meio).
  await Promise.all(pendingPuts)
  for (const key of keysToRemove) removeStorageKey(key)
}

/** Hidrata o espelho em memória a partir do IndexedDB (idempotente). */
export function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (hydrationPromise) return hydrationPromise

  hydrationPromise = (async () => {
    try {
      await migrateFromLocalStorage()
      const backend = getBackend()
      if (backend.available()) {
        const [sheetsRows, outboxRows] = await Promise.all([
          backend.getAll('sheets'),
          backend.getAll('outbox'),
        ])
        for (const { key, value } of sheetsRows) {
          mirrors.sheets.set(key, value)
        }
        for (const { key, value } of outboxRows) {
          mirrors.outbox.set(key, value)
        }
      }
    } catch {
      // Falha de hidratação: segue com o espelho vazio (nunca impede o render).
    } finally {
      hydrated = true
      hydrationPromise = null
    }
  })()

  return hydrationPromise
}

// --- Leituras/escritas síncronas no espelho -------------------------------

/** Lê um valor do espelho (síncrono). */
export function kvGet<T>(store: StoreName, key: string): T | undefined {
  return mirror(store).get(key) as T | undefined
}

/** Grava no espelho (síncrono) e persiste no IndexedDB (assíncrono). */
export function kvSet(store: StoreName, key: string, value: unknown): void {
  mirror(store).set(key, value)
  persist(store, key, value)
}

/** Remove do espelho (síncrono) e do IndexedDB (assíncrono). */
export function kvDelete(store: StoreName, key: string): void {
  mirror(store).delete(key)
  persistDelete(store, key)
}

/** Esvazia a store no espelho (síncrono) e no IndexedDB (assíncrono). */
export function kvClear(store: StoreName): void {
  mirror(store).clear()
  persistClear(store)
}

/** Lista as chaves da store no espelho (síncrono). */
export function kvKeys(store: StoreName): string[] {
  return [...mirror(store).keys()]
}

/** Quantidade de entradas da store no espelho (síncrono). */
export function kvSize(store: StoreName): number {
  return mirror(store).size
}

/** Reinicia o espelho e o estado de hidratação (apenas testes). */
export function _resetForTests(): void {
  for (const store of STORES) {
    mirrors[store] = new Map()
  }
  hydrated = false
  hydrationPromise = null
}
