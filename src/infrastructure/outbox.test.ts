import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetForTests, kvSet } from '@/infrastructure/kvStore'
import { clear, count, enqueue, list, remove } from '@/infrastructure/outbox'
import type { Mutation } from '@/infrastructure/outbox'

/**
 * Testes do outbox (Fase 1 do plano PWA), adaptados à Fase 5 (IndexedDB com
 * espelho em memória). O ambiente de testes é `node` (sem `indexedDB`), então
 * as operações rodam no espelho em memória — sem persistência real.
 */

beforeEach(() => {
  _resetForTests()
})

afterEach(() => {
  // Nada a restaurar: o espelho é resetado no `beforeEach`.
})

describe('outbox — enqueue/list/remove/clear/count', () => {
  it('enfileira e conta as pendências', () => {
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })
    enqueue({ sheet: 'Proventos', kind: 'remove', entityId: 'b' })

    expect(count()).toBe(2)
    expect(list().map((mutation) => mutation.kind).sort()).toEqual(['append', 'remove'])
    expect(list().map((mutation) => mutation.sheet).sort()).toEqual(['Operacoes', 'Proventos'])
  })

  it('gera ids únicos e `createdAt` em ISO 8601', () => {
    const first = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })
    const second = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'b' } })

    expect(first.id).not.toBe(second.id)
    expect(first.id.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false)
  })

  it('remove uma mutação pelo id e mantém o restante', () => {
    const kept = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })
    const dropped = enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'b' } })

    remove(dropped.id)

    expect(list().map((mutation) => mutation.id)).toEqual([kept.id])
    expect(count()).toBe(1)
  })

  it('clear esvazia a fila', () => {
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'a' } })

    clear()

    expect(count()).toBe(0)
    expect(list()).toEqual([])
  })
})

describe('outbox — ordenação FIFO por createdAt', () => {
  it('ordena por createdAt ASC com id como desempate (independente da inserção)', () => {
    const tieA: Mutation = {
      id: 'tie-a',
      createdAt: '2026-10-11T00:00:00.000Z',
      sheet: 'Operacoes',
      kind: 'append',
      entity: {},
    }
    const tieB: Mutation = {
      id: 'tie-b',
      createdAt: '2026-10-11T00:00:00.000Z',
      sheet: 'Operacoes',
      kind: 'append',
      entity: {},
    }
    const older: Mutation = {
      id: 'b',
      createdAt: '2026-10-11T00:00:01.000Z',
      sheet: 'Operacoes',
      kind: 'append',
      entity: {},
    }
    const newest: Mutation = {
      id: 'a',
      createdAt: '2026-10-11T00:00:02.000Z',
      sheet: 'Operacoes',
      kind: 'append',
      entity: {},
    }

    // Inserção propositalmente fora de ordem — `newId()` (randomUUID) não é
    // ordenável, então a fila NÃO pode depender da ordem de inserção.
    kvSet('outbox', newest.id, newest)
    kvSet('outbox', tieB.id, tieB)
    kvSet('outbox', older.id, older)
    kvSet('outbox', tieA.id, tieA)

    expect(list().map((mutation) => mutation.id)).toEqual(['tie-a', 'tie-b', 'b', 'a'])
  })
})

