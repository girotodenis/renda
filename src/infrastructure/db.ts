/**
 * Primitivas assíncronas de IndexedDB (Fase 5 do plano PWA).
 *
 * O IndexedDB substitui o `localStorage` para o cache de abas e o outbox — cota
 * bem maior (~5 MB no localStorage vs. centenas de MB no IndexedDB) e escrita
 * assíncrona que não bloqueia a UI. `token`/`workspace`/`consent` continuam no
 * `localStorage` (não migram).
 *
 * Quando o ambiente não possui `indexedDB` (testes Node), as primitivas **não
 * lançam**: caem em no-op/fallback, para que imports e usos não quebrem.
 */

export const DB_NAME = 'minhaacoes'
export const DB_VERSION = 1

export const SHEETS_STORE = 'sheets'
export const OUTBOX_STORE = 'outbox'

export type StoreName = typeof SHEETS_STORE | typeof OUTBOX_STORE

/** Entrada lida de uma object store (chave + valor). */
export interface IdbEntry {
  key: string
  value: unknown
}

/**
 * Backend de persistência. Na aplicação é o IndexedDB real; nos testes pode
 * ser substituído por uma implementação em memória (`_setBackendForTests`).
 */
export interface IdbBackend {
  /** `false` quando o IndexedDB não está disponível (fallback em memória). */
  available(): boolean
  getAll(store: StoreName): Promise<IdbEntry[]>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  clear(store: StoreName): Promise<void>
}

function idbAvailable(): boolean {
  return typeof globalThis.indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Abre o banco (singleton). Resolve `null` quando o IDB é indisponível. */
export function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(SHEETS_STORE)) {
          db.createObjectStore(SHEETS_STORE)
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE)
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        dbPromise = null
        resolve(null)
      }
      request.onblocked = () => {
        dbPromise = null
        resolve(null)
      }
    } catch {
      dbPromise = null
      resolve(null)
    }
  })

  return dbPromise
}

const realBackend: IdbBackend = {
  available: idbAvailable,

  async getAll(store: StoreName): Promise<IdbEntry[]> {
    const db = await openDb()
    if (!db) return []
    return new Promise<IdbEntry[]>((resolve) => {
      try {
        const tx = db.transaction(store, 'readonly')
        const objectStore = tx.objectStore(store)
        const valuesRequest = objectStore.getAll()
        const keysRequest = objectStore.getAllKeys()

        tx.oncomplete = () => {
          const values = valuesRequest.result as unknown[]
          const keys = keysRequest.result as string[]
          resolve(keys.map((key, index) => ({ key, value: values[index] })))
        }
        tx.onerror = () => resolve([])
        tx.onabort = () => resolve([])
      } catch {
        resolve([])
      }
    })
  },

  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  },

  async delete(store: StoreName, key: string): Promise<void> {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  },

  async clear(store: StoreName): Promise<void> {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  },
}

let currentBackend: IdbBackend = realBackend

/** Backend ativo (real por padrão; substituível nos testes). */
export function getBackend(): IdbBackend {
  return currentBackend
}

/**
 * Substitui o backend de persistência (apenas testes). Passar `null` restaura
 * o backend real (IndexedDB).
 */
export function _setBackendForTests(backend: IdbBackend | null): void {
  currentBackend = backend ?? realBackend
}
