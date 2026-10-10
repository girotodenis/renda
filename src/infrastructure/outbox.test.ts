import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clear,
  count,
  enqueue,
  list,
  OUTBOX_STORAGE_KEY,
  remove,
} from '@/infrastructure/outbox'

/**
 * Testes do outbox (Fase 1 do plano PWA).
 *
 * O ambiente de testes é `node` (sem `window`/`localStorage`), então o
 * `localStorage` é simulado em memória. A leitura sempre passa pelo
 * `localStorage`, o que também exercita a persistência entre "reloads".
 */

/** Implementação em memória do `localStorage` (suficiente para o outbox). */
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

let storage: Storage

beforeEach(() => {
  storage = createMemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('outbox — enqueue/list/remove/clear/count', () => {
  it('enfileira na ordem FIFO e conta as pendências', () => {
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })
    enqueue({ sheet: 'Proventos', kind: 'remove', entityId: 'b' })

    expect(count()).toBe(2)
    expect(list().map((mutation) => mutation.kind)).toEqual(['append', 'remove'])
    expect(list().map((mutation) => mutation.sheet)).toEqual(['Operacoes', 'Proventos'])
  })

  it('gera ids únicos e `createdAt` em ISO 8601', () => {
    const first = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })
    const second = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'b' } })

    expect(first.id).not.toBe(second.id)
    expect(first.id.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false)
  })

  it('remove uma mutação pelo id e mantém o restante na ordem', () => {
    const kept = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })
    const dropped = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'b' } })

    remove(dropped.id)

    expect(list().map((mutation) => mutation.id)).toEqual([kept.id])
    expect(count()).toBe(1)
  })

  it('clear esvazia a fila e remove a chave do localStorage', () => {
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })

    clear()

    expect(count()).toBe(0)
    expect(list()).toEqual([])
    expect(storage.getItem(OUTBOX_STORAGE_KEY)).toBeNull()
  })
})

describe('outbox — persistência entre reloads', () => {
  it('persiste as mutações no localStorage e as relê integralmente', () => {
    enqueue({
      sheet: 'Operacoes',
      kind: 'update',
      entity: { id: 'a', ticker: 'PETR4' },
      entityId: 'a',
    })

    const raw = storage.getItem(OUTBOX_STORAGE_KEY)
    expect(raw).toBeTruthy()

    // "Reload": cada leitura vai ao localStorage (não há cache em memória).
    const reloaded = list()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toMatchObject({
      sheet: 'Operacoes',
      kind: 'update',
      entityId: 'a',
      entity: { id: 'a', ticker: 'PETR4' },
    })
    expect(count()).toBe(1)
  })

  it('tolera ausência de localStorage (fila vazia, sem lançar)', () => {
    vi.unstubAllGlobals()

    expect(list()).toEqual([])
    expect(count()).toBe(0)
  })
})
