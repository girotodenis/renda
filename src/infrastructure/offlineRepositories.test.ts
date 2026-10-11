import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Consolidado, Operacao } from '@/domain/entities'
import type { CrudRepository, RepositoryContext } from '@/domain/repositories/ports'
import { readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import { _resetForTests } from '@/infrastructure/kvStore'
import { withOfflineOutbox } from '@/infrastructure/offlineRepositories'
import { count, list as outboxList } from '@/infrastructure/outbox'
import { consolidadoRepo, operacoesRepo } from '@/infrastructure/repositories'

/**
 * Testes do decorador offline dos repositórios (Fase 1 do plano PWA),
 * adaptados à Fase 5 (cache/outbox no IndexedDB com espelho em memória).
 *
 * Cobrem a atualização otimista do cache + enfileiramento no outbox quando
 * offline (ou em falha de rede/quota) e a garantia de que a aba derivada
 * `Consolidado` **nunca** enfileira. O ambiente de testes é `node` (sem
 * `indexedDB`), então o espelho em memória é resetado a cada teste e
 * `navigator`/`fetch` são simulados.
 */

interface Item {
  id: string
  nome: string
}

interface FakeCalls {
  append: number
  replaceAll: number
  update: number
  remove: number
  lastReplaceAllCount: number
  lastRemovedId: string | null
}

type FakeRepo = CrudRepository<Item> & { calls: FakeCalls }

/** Repositório falso que registra as chamadas (não toca em rede). */
function createFakeRepo(options: { appendError?: unknown } = {}): FakeRepo {
  const calls: FakeCalls = {
    append: 0,
    replaceAll: 0,
    update: 0,
    remove: 0,
    lastReplaceAllCount: 0,
    lastRemovedId: null,
  }

  return {
    sheetName: 'Operacoes',
    calls,
    newId: () => 'novo-id',
    async list() {
      return []
    },
    readCache() {
      return null
    },
    async refresh() {
      return []
    },
    invalidateCache() {},
    async append(_context, entity) {
      calls.append += 1
      if (options.appendError !== undefined) throw options.appendError
      return entity
    },
    async replaceAll(_context, entities) {
      calls.replaceAll += 1
      calls.lastReplaceAllCount = entities.length
    },
    async update(_context, entity) {
      calls.update += 1
      return entity
    },
    async remove(_context, id) {
      calls.remove += 1
      calls.lastRemovedId = id
    },
  }
}

const context: RepositoryContext = { accessToken: 'token', spreadsheetId: 'planilha' }

/** Lê as linhas em cache de uma aba (helper dos asserts). */
function cachedRows<T>(sheetName: 'Operacoes'): T[] | undefined {
  return readSheetCache<T>(context.spreadsheetId, sheetName)?.rows
}

beforeEach(() => {
  _resetForTests()
  vi.stubGlobal('navigator', { onLine: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('withOfflineOutbox — offline (atualização otimista + outbox)', () => {
  it('append: atualiza o cache local e enfileira sem chamar o repositório real', async () => {
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const item: Item = { id: 'a', nome: 'PETR4' }
    const returned = await wrapped.append(context, item)

    expect(returned).toBe(item)
    expect(repo.calls.append).toBe(0)
    expect(count()).toBe(1)
    expect(outboxList()[0]).toMatchObject({ sheet: 'Operacoes', kind: 'append' })
    expect(cachedRows<Item>('Operacoes')).toEqual([item])
  })

  it('update: substitui a linha em cache pelo id e enfileira', async () => {
    writeSheetCache<Item>(context.spreadsheetId, 'Operacoes', [
      { id: 'a', nome: 'antigo' },
      { id: 'b', nome: 'outro' },
    ])
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const updated: Item = { id: 'a', nome: 'novo' }
    const returned = await wrapped.update(context, updated)

    expect(returned).toBe(updated)
    expect(repo.calls.update).toBe(0)
    expect(outboxList()[0]).toMatchObject({ kind: 'update', entityId: 'a' })
    expect(cachedRows<Item>('Operacoes')).toEqual([updated, { id: 'b', nome: 'outro' }])
  })

  it('remove: filtra a linha pelo id e enfileira', async () => {
    writeSheetCache<Item>(context.spreadsheetId, 'Operacoes', [
      { id: 'a', nome: 'PETR4' },
      { id: 'b', nome: 'VALE3' },
    ])
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    await wrapped.remove(context, 'a')

    expect(repo.calls.remove).toBe(0)
    expect(outboxList()[0]).toMatchObject({ kind: 'remove', entityId: 'a' })
    expect(cachedRows<Item>('Operacoes')).toEqual([{ id: 'b', nome: 'VALE3' }])
  })

  it('replaceAll: grava a lista inteira no cache e enfileira', async () => {
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const items: Item[] = [
      { id: 'a', nome: 'PETR4' },
      { id: 'b', nome: 'VALE3' },
    ]
    await wrapped.replaceAll(context, items)

    expect(repo.calls.replaceAll).toBe(0)
    expect(outboxList()[0]).toMatchObject({ kind: 'replaceAll' })
    expect(cachedRows<Item>('Operacoes')).toEqual(items)
  })
})

describe('withOfflineOutbox — online (escrita direta)', () => {
  it('vai direto ao repositório real e não usa o outbox', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const item: Item = { id: 'a', nome: 'PETR4' }
    const returned = await wrapped.append(context, item)

    expect(returned).toBe(item)
    expect(repo.calls.append).toBe(1)
    expect(count()).toBe(0)
    expect(readSheetCache(context.spreadsheetId, 'Operacoes')).toBeNull()
  })

  it('falha de rede (status 0) cai para o outbox com atualização otimista', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const repo = createFakeRepo({
      appendError: Object.assign(new Error('rede'), { status: 0 }),
    })
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const item: Item = { id: 'a', nome: 'PETR4' }
    const returned = await wrapped.append(context, item)

    expect(returned).toBe(item)
    expect(repo.calls.append).toBe(1)
    expect(count()).toBe(1)
    expect(cachedRows<Item>('Operacoes')).toEqual([item])
  })

  it('cota excedida (status 429) cai para o outbox', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const repo = createFakeRepo({
      appendError: Object.assign(new Error('quota'), { status: 429 }),
    })
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    await wrapped.append(context, { id: 'a', nome: 'PETR4' })

    expect(count()).toBe(1)
  })

  it('erro não recuperável (ex.: 403) propaga e não enfileira', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const repo = createFakeRepo({
      appendError: Object.assign(new Error('proibido'), { status: 403 }),
    })
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    await expect(wrapped.append(context, { id: 'a', nome: 'PETR4' })).rejects.toMatchObject({
      status: 403,
    })
    expect(count()).toBe(0)
  })
})

describe('withOfflineOutbox — outbox desabilitado (aba derivada)', () => {
  it('escreve direto mesmo offline, sem atualização otimista nem outbox', async () => {
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id, outboxEnabled: false })

    const item: Item = { id: 'a', nome: 'PETR4' }
    await wrapped.append(context, item)

    expect(repo.calls.append).toBe(1)
    expect(count()).toBe(0)
    expect(readSheetCache(context.spreadsheetId, 'Operacoes')).toBeNull()
  })
})

describe('repositórios reais — caminho offline', () => {
  function operacaoBase(): Operacao {
    return {
      id: 'op-1',
      data: '2026-10-10',
      tipo: OperacaoTipo.Compra,
      categoria: CategoriaAtivo.Acao,
      ticker: 'PETR4',
      quantidade: 10,
      precoUnitario: 2500,
      taxas: 0,
      indexador: null,
      percentualIndexador: null,
      vencimento: null,
      valorBrutoAtual: null,
    }
  }

  it('operacoesRepo.append offline: cache atualizado + outbox, sem chamar a API', async () => {
    const fetchSpy = vi.fn(() => {
      throw new TypeError('fetch não deveria ser chamado offline')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const operacao = operacaoBase()
    const returned = await operacoesRepo.append(context, operacao)

    expect(returned).toBe(operacao)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(count()).toBe(1)
    expect(outboxList()[0]).toMatchObject({ sheet: 'Operacoes', kind: 'append' })
    expect(readSheetCache<Operacao>(context.spreadsheetId, 'Operacoes')?.rows).toEqual([operacao])
  })

  it('consolidadoRepo.append nunca enfileira (aba derivada)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('rede indisponível')))
    vi.stubGlobal('fetch', fetchSpy)

    const linha: Consolidado = {
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      quantidadeAtual: 10,
      precoMedio: 2500,
      precoAtual: 2500,
      totalInvestido: 25000,
      valorAtual: 25000,
      lucroPrejuizo: 0,
      lucroPrejuizoPercent: 0,
      percentualCarteira: 100,
    }

    await expect(consolidadoRepo.append(context, linha)).rejects.toBeTruthy()
    expect(count()).toBe(0)
    expect(outboxList()).toEqual([])
  })
})
