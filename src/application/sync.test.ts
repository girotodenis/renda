import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { garantirSincronizado, sincronizarPendentes } from '@/application/sync'
import type { SyncDependencies } from '@/application/sync'
import { MODO_GOOGLE, MODO_LOCAL } from '@/domain/armazenamento'
import type { RepositoryContext } from '@/domain/repositories/ports'
import { _resetForTests } from '@/infrastructure/kvStore'
import {
  _resetModoArmazenamentoForTests,
  setModoArmazenamento,
} from '@/infrastructure/modoArmazenamento'
import { enqueue } from '@/infrastructure/outbox'
import type { Mutation } from '@/infrastructure/outbox'

/**
 * Testes da sincronização do outbox (Fase 2 do plano PWA).
 *
 * Usam dependências falsas injetadas — sem `localStorage`, rede ou repositórios
 * reais — para validar ordem FIFO, sucesso parcial (erro de rede no meio),
 * idempotência do `append` e o recálculo único do `Consolidado` ao final.
 */

const context: RepositoryContext = { accessToken: 'token', spreadsheetId: 'planilha' }

function makeMutation(partial: Partial<Mutation> & { id: string }): Mutation {
  const { id, ...rest } = partial
  return {
    id,
    createdAt: '2026-10-10T10:00:00.000Z',
    sheet: 'Operacoes',
    kind: 'append',
    entity: { id },
    ...rest,
  }
}

interface FakeSync {
  deps: SyncDependencies
  fila: Mutation[]
  removidos: string[]
  replayOrder: string[]
  erros: Map<string, unknown>
  duplicados: Set<string>
  syncCalls: () => number
  prefetchCalls: () => number
  prefetchOpcoes: () => Array<{ excluirMutacoes?: ReadonlySet<string> } | undefined>
  batchCalls: () => number
}

/** Fábrica de dependências falsas com estado observável. */
function createFakes(initial: Mutation[]): FakeSync {
  const fila = initial.map((mutation) => ({ ...mutation }))
  const removidos: string[] = []
  const replayOrder: string[] = []
  const erros = new Map<string, unknown>()
  const duplicados = new Set<string>()
  const tentativas = new Map<string, number>()
  let syncCalls = 0
  let prefetchCalls = 0
  const prefetchOpcoes: Array<{ excluirMutacoes?: ReadonlySet<string> } | undefined> = []
  let batchCalls = 0

  const deps: SyncDependencies = {
    listMutations: () => fila.map((mutation) => ({ ...mutation })),
    removeMutation: (id) => {
      removidos.push(id)
      const index = fila.findIndex((mutation) => mutation.id === id)
      if (index >= 0) fila.splice(index, 1)
    },
    replayMutation: async (_context, mutation) => {
      replayOrder.push(mutation.id)
      const count = (tentativas.get(mutation.id) ?? 0) + 1
      tentativas.set(mutation.id, count)
      const erro = erros.get(mutation.id)
      // Erro apenas na primeira tentativa — a re-tentativa (ex.: após 401) passa.
      if (erro !== undefined && count === 1) throw erro
    },
    appendJaExiste: async (_context, _sheet, entity) =>
      duplicados.has(String((entity as { id?: unknown }).id ?? '')),
    syncConsolidado: async () => {
      syncCalls += 1
    },
    prefetchAllSheets: async (_context, options) => {
      prefetchCalls += 1
      prefetchOpcoes.push(options)
    },
    executarEmLote: async (_context, fn) => {
      batchCalls += 1
      return fn()
    },
  }

  return {
    deps,
    fila,
    removidos,
    replayOrder,
    erros,
    duplicados,
    syncCalls: () => syncCalls,
    prefetchCalls: () => prefetchCalls,
    prefetchOpcoes: () => prefetchOpcoes,
    batchCalls: () => batchCalls,
  }
}

describe('sincronizarPendentes', () => {
  it('reaplica as mutações em ordem FIFO', async () => {
    const m1 = makeMutation({ id: 'm1' })
    const m2 = makeMutation({ id: 'm2', sheet: 'Proventos', entity: { id: 'p-2' } })
    const m3 = makeMutation({ id: 'm3', kind: 'replaceAll', entity: undefined, entities: [] })
    const fakes = createFakes([m1, m2, m3])

    const resultado = await sincronizarPendentes(context, { deps: fakes.deps })

    expect(fakes.replayOrder).toEqual(['m1', 'm2', 'm3'])
    expect(resultado.aplicadas).toBe(3)
    expect(resultado.pendentes).toBe(0)
    expect(resultado.erro).toBeUndefined()
  })

  it('interrompe em erro de rede no meio e preserva os itens restantes', async () => {
    const m1 = makeMutation({ id: 'm1' })
    const m2 = makeMutation({ id: 'm2' })
    const m3 = makeMutation({ id: 'm3' })
    const fakes = createFakes([m1, m2, m3])
    fakes.erros.set('m2', { status: 0 })

    const resultado = await sincronizarPendentes(context, { deps: fakes.deps })

    expect(fakes.replayOrder).toEqual(['m1', 'm2'])
    expect(resultado.aplicadas).toBe(1)
    expect(resultado.pendentes).toBe(2)
    expect(resultado.erro).toBeUndefined()
    // Nada é consolidado quando o flush é interrompido por rede.
    expect(fakes.syncCalls()).toBe(0)
  })

  it('pula append duplicado (idempotência) e remove o item da fila', async () => {
    const m1 = makeMutation({ id: 'm1', entity: { id: 'op-1' } })
    const m2 = makeMutation({ id: 'm2', entity: { id: 'op-2' } })
    const fakes = createFakes([m1, m2])
    fakes.duplicados.add('op-1')

    const resultado = await sincronizarPendentes(context, { deps: fakes.deps })

    expect(fakes.replayOrder).toEqual(['m2'])
    expect(fakes.removidos).toEqual(['m1', 'm2'])
    expect(resultado.aplicadas).toBe(2)
    expect(resultado.pendentes).toBe(0)
  })

  it('recalcula o Consolidado uma única vez ao final do flush', async () => {
    const m1 = makeMutation({ id: 'm1' })
    const m2 = makeMutation({ id: 'm2' })
    const fakes = createFakes([m1, m2])

    const resultado = await sincronizarPendentes(context, { deps: fakes.deps })

    expect(resultado.aplicadas).toBe(2)
    expect(fakes.syncCalls()).toBe(1)
    expect(fakes.prefetchCalls()).toBe(1)
  })

  it('renova o token em 401 e re-tenta uma única vez', async () => {
    const m1 = makeMutation({ id: 'm1' })
    const fakes = createFakes([m1])
    fakes.erros.set('m1', { status: 401 })
    const obterToken = vi.fn(async () => 'novo-token')

    const resultado = await sincronizarPendentes(context, { obterToken, deps: fakes.deps })

    expect(obterToken).toHaveBeenCalledTimes(1)
    // Primeira tentativa falha com 401; a re-tentativa reaplica a mesma mutação.
    expect(fakes.replayOrder).toEqual(['m1', 'm1'])
    expect(resultado.aplicadas).toBe(1)
    expect(resultado.pendentes).toBe(0)
  })

  it('interrompe quando a renovação do token falha', async () => {
    const m1 = makeMutation({ id: 'm1' })
    const fakes = createFakes([m1])
    fakes.erros.set('m1', { status: 401 })
    const obterToken = vi.fn(async () => null)

    const resultado = await sincronizarPendentes(context, { obterToken, deps: fakes.deps })

    expect(obterToken).toHaveBeenCalledTimes(1)
    expect(resultado.aplicadas).toBe(0)
    expect(resultado.pendentes).toBe(1)
    expect(resultado.erro).toContain('Sessão expirada')
  })

  it('aplica a fila inteira em um único lote', async () => {
    const fakes = createFakes([
      makeMutation({ id: 'm1' }),
      makeMutation({ id: 'm2' }),
      makeMutation({ id: 'm3' }),
    ])

    const resultado = await sincronizarPendentes(context, { deps: fakes.deps })

    // 1 gravação em lote para as 3 mutações (no backend JSON: 1 read + 1 write).
    expect(fakes.batchCalls()).toBe(1)
    expect(resultado.aplicadas).toBe(3)
  })

  it('mantém a fila quando a gravação do lote falha', async () => {
    const fakes = createFakes([makeMutation({ id: 'm1' }), makeMutation({ id: 'm2' })])

    const resultado = await sincronizarPendentes(context, {
      deps: {
        ...fakes.deps,
        executarEmLote: async (_context, fn) => {
          await fn()
          throw new Error('Falha ao gravar o banco no Drive.')
        },
      },
    })

    expect(fakes.removidos).toEqual([])
    expect(resultado.aplicadas).toBe(0)
    expect(resultado.pendentes).toBe(2)
    expect(resultado.erro).toContain('Drive')
  })
})

describe('sincronizarPendentes — reidratação do cache', () => {
  it('exclui do prefetch as mutações já gravadas (evita duplicar linhas)', async () => {
    const m1 = makeMutation({ id: 'm1', entity: { id: 'op-1' } })
    const m2 = makeMutation({ id: 'm2', entity: { id: 'op-2' } })
    const m3 = makeMutation({ id: 'm3', entity: { id: 'op-3' } })
    const fakes = createFakes([m1, m2, m3])
    fakes.erros.set('m2', { status: 500 })

    await sincronizarPendentes(context, { deps: fakes.deps })

    expect(fakes.prefetchCalls()).toBe(1)
    const [opcoes] = fakes.prefetchOpcoes()
    expect([...(opcoes?.excluirMutacoes ?? [])].sort()).toEqual(['m1', 'm3'])
  })
})

describe('garantirSincronizado', () => {
  const flushes: Array<{ pendentes: number }> = []

  function depsComResultado(pendentes: number): Partial<SyncDependencies> {
    return {
      listMutations: () => [makeMutation({ id: 'm1' })],
      removeMutation: () => {},
      replayMutation: async () => {},
      appendJaExiste: async () => false,
      syncConsolidado: async () => {},
      prefetchAllSheets: async () => {},
      executarEmLote: async (_context, fn) => {
        const resultado = await fn()
        flushes.push({ pendentes })
        return resultado
      },
    }
  }

  beforeEach(() => {
    flushes.length = 0
    _resetForTests()
    _resetModoArmazenamentoForTests()
    setModoArmazenamento(MODO_GOOGLE)
    vi.stubGlobal('navigator', { onLine: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('não fala com o banco quando a fila está vazia', async () => {
    await expect(garantirSincronizado(context, { deps: depsComResultado(0) })).resolves.toBeUndefined()
    expect(flushes).toEqual([])
  })

  it('é no-op no modo local (o banco do navegador é a origem)', async () => {
    setModoArmazenamento(MODO_LOCAL)
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'op-1' } })

    await expect(garantirSincronizado(context, { deps: depsComResultado(1) })).resolves.toBeUndefined()
    expect(flushes).toEqual([])
  })

  it('lança quando há pendências e o flush não as zera', async () => {
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'op-1' } })

    await expect(
      garantirSincronizado(context, { deps: depsComResultado(1) }),
    ).rejects.toThrow(/alterações pendentes/i)
    expect(flushes).toHaveLength(1)
  })

  it('lança quando não há conexão e existe fila', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    enqueue({ sheet: 'Operacoes', kind: 'append', entity: { id: 'op-1' } })

    await expect(garantirSincronizado(context, { deps: depsComResultado(0) })).rejects.toThrow(
      /Conecte-se à internet/i,
    )
  })
})
