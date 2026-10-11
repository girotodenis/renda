import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import { _setBackendForTests } from '@/infrastructure/db'
import type { IdbBackend, IdbEntry, StoreName } from '@/infrastructure/db'
import { _resetForTests, ensureHydrated, kvGet, kvSet } from '@/infrastructure/kvStore'
import { enqueue, list as outboxList } from '@/infrastructure/outbox'
import type { Mutation } from '@/infrastructure/outbox'

/**
 * Testes do espelho em memória + migração (Fase 5 do plano PWA).
 *
 * O ambiente de testes é `node` (sem `indexedDB`). Os testes usam um backend
 * em memória (stub do IndexedDB) para exercitar persistência, releitura e a
 * migração única do `localStorage`.
 */

/** Implementação em memória do `localStorage` (para o teste de migração). */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

/** Backend IndexedDB em memória (stub substituível em `db.ts`). */
interface MemoryBackend extends IdbBackend {
  stores: Record<StoreName, Map<string, unknown>>
}

function createMemoryBackend(): MemoryBackend {
  const stores: Record<StoreName, Map<string, unknown>> = {
    sheets: new Map(),
    outbox: new Map(),
  }
  return {
    stores,
    available: () => true,
    async getAll(store: StoreName): Promise<IdbEntry[]> {
      return [...stores[store].entries()].map(([key, value]) => ({ key, value }))
    },
    async put(store: StoreName, key: string, value: unknown): Promise<void> {
      stores[store].set(key, value)
    },
    async delete(store: StoreName, key: string): Promise<void> {
      stores[store].delete(key)
    },
    async clear(store: StoreName): Promise<void> {
      stores[store].clear()
    },
  }
}

let backend: MemoryBackend

beforeEach(() => {
  _resetForTests()
  backend = createMemoryBackend()
  _setBackendForTests(backend)
})

afterEach(() => {
  _setBackendForTests(null)
  vi.unstubAllGlobals()
})

describe('kvStore — fallback sem IndexedDB', () => {
  it('hidrata e opera apenas em memória, sem lançar', async () => {
    // Backend real indisponível no ambiente Node (sem `indexedDB`).
    _setBackendForTests(null)
    _resetForTests()

    await expect(ensureHydrated()).resolves.toBeUndefined()

    kvSet('sheets', 'planilha.Operacoes', {
      spreadsheetId: 'planilha',
      sheetName: 'Operacoes',
      updatedAt: '2026-10-11T00:00:00.000Z',
      rows: [{ id: 'a' }],
    })

    expect(kvGet('sheets', 'planilha.Operacoes')).toMatchObject({
      spreadsheetId: 'planilha',
    })
  })
})

describe('kvStore — persistência e releitura do espelho', () => {
  it('grava no backend e repovoa o espelho após nova hidratação (reload)', async () => {
    await ensureHydrated()

    writeSheetCache('planilha', 'Operacoes', [{ id: 'a' }])
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })

    // As escritas síncronas persistem no backend (stub em memória é imediato).
    expect(backend.stores.sheets.has('planilha.Operacoes')).toBe(true)
    expect(backend.stores.outbox.size).toBe(1)

    // Simula um reload: zera o espelho e hidrata novamente a partir do backend.
    _resetForTests()
    await ensureHydrated()

    expect(readSheetCache('planilha', 'Operacoes')?.rows).toEqual([{ id: 'a' }])
    expect(outboxList()).toHaveLength(1)
  })
})

describe('kvStore — migração única do localStorage', () => {
  it('importa cache e outbox para o IndexedDB e limpa as chaves antigas', async () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'minhaacoes.cache.v1.planilha.Operacoes',
      JSON.stringify({
        spreadsheetId: 'planilha',
        sheetName: 'Operacoes',
        updatedAt: '2026-10-11T00:00:00.000Z',
        rows: [{ id: 'a' }],
      }),
    )
    const mutation: Mutation = {
      id: 'm-1',
      createdAt: '2026-10-11T00:00:00.000Z',
      sheet: 'Operacoes',
      kind: 'append',
      entity: { id: 'a' },
    }
    storage.setItem('minhaacoes.outbox.v1', JSON.stringify([mutation]))
    vi.stubGlobal('window', { localStorage: storage })

    await ensureHydrated()

    // Importado para o IndexedDB...
    expect(backend.stores.sheets.get('planilha.Operacoes')).toMatchObject({
      spreadsheetId: 'planilha',
      rows: [{ id: 'a' }],
    })
    expect(backend.stores.outbox.get('m-1')).toMatchObject({ id: 'm-1' })

    // ...e removido do localStorage.
    expect(storage.getItem('minhaacoes.cache.v1.planilha.Operacoes')).toBeNull()
    expect(storage.getItem('minhaacoes.outbox.v1')).toBeNull()

    // O espelho reflete os dados migrados.
    expect(readSheetCache('planilha', 'Operacoes')?.rows).toEqual([{ id: 'a' }])
    expect(outboxList()).toEqual([mutation])
  })

  it('não migra do localStorage quando o IndexedDB já tem dados', async () => {
    // Semeia o backend com um registro (IndexedDB não vazio → sem migração).
    backend.stores.sheets.set('planilha.Proventos', {
      spreadsheetId: 'planilha',
      sheetName: 'Proventos',
      updatedAt: '2026-10-11T00:00:00.000Z',
      rows: [],
    })

    const storage = createMemoryStorage()
    storage.setItem(
      'minhaacoes.cache.v1.planilha.Operacoes',
      JSON.stringify({
        spreadsheetId: 'planilha',
        sheetName: 'Operacoes',
        updatedAt: '2026-10-11T00:00:00.000Z',
        rows: [{ id: 'a' }],
      }),
    )
    vi.stubGlobal('window', { localStorage: storage })

    await ensureHydrated()

    // Chave antiga NÃO é removida (IndexedDB não estava vazio).
    expect(storage.getItem('minhaacoes.cache.v1.planilha.Operacoes')).not.toBeNull()
    // O espelho hidrata apenas do backend já existente.
    expect(readSheetCache('planilha', 'Proventos')?.rows).toEqual([])
    expect(readSheetCache('planilha', 'Operacoes')).toBeNull()
  })
})
