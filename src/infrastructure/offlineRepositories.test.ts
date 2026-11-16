import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODO_GOOGLE, MODO_LOCAL } from '@/domain/armazenamento'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Consolidado, Operacao } from '@/domain/entities'
import type { CrudRepository, RepositoryContext } from '@/domain/repositories/ports'
import { readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import { _resetForTests } from '@/infrastructure/kvStore'
import {
  comEscritaImediata,
  isEscritaImediata,
  withOfflineOutbox,
} from '@/infrastructure/offlineRepositories'
import {
  _resetModoArmazenamentoForTests,
  setModoArmazenamento,
} from '@/infrastructure/modoArmazenamento'
import { count, list as outboxList } from '@/infrastructure/outbox'
import { consolidadoRepo, operacoesRepo } from '@/infrastructure/repositories'

/**
 * Testes do decorador local-first dos repositórios.
 *
 * Cobrem o novo contrato: toda escrita (com ou sem rede) atualiza o cache e
 * enfileira no outbox, sem tocar na origem; as pendências são reaplicadas sobre
 * o cache depois de uma leitura da origem; `comEscritaImediata` desvia da fila;
 * e a aba derivada `Consolidado` **nunca** enfileira. O ambiente de testes é
 * `node` (sem `indexedDB`), então o espelho em memória é resetado a cada teste
 * e `navigator`/`fetch` são simulados.
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
  refresh: number
  lastReplaceAllCount: number
  lastRemovedId: string | null
}

type FakeRepo = CrudRepository<Item> & { calls: FakeCalls }

/**
 * Repositório falso que registra as chamadas (não toca em rede).
 *
 * `refresh` grava o cache como o repositório real faz, para que o decorador
 * reaplique as pendências do outbox sobre o resultado da "origem".
 */
function createFakeRepo(options: { remoteRows?: Item[] } = {}): FakeRepo {
  const remoteRows = options.remoteRows ?? []
  const calls: FakeCalls = {
    append: 0,
    replaceAll: 0,
    update: 0,
    remove: 0,
    refresh: 0,
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
    readCache(spreadsheetId) {
      return readSheetCache<Item>(spreadsheetId, 'Operacoes')?.rows ?? null
    },
    async refresh(context) {
      calls.refresh += 1
      writeSheetCache(context.spreadsheetId, 'Operacoes', remoteRows.slice())
      return remoteRows.slice()
    },
    invalidateCache() {},
    async append(_context, entity) {
      calls.append += 1
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
  _resetModoArmazenamentoForTests()
  setModoArmazenamento(MODO_GOOGLE)
  vi.stubGlobal('navigator', { onLine: false })
})

afterEach(() => {
  setModoArmazenamento(MODO_GOOGLE)
  vi.unstubAllGlobals()
})

describe('withOfflineOutbox — local-first', () => {
  it('append: atualiza o cache local e enfileira sem chamar o repositório real', async () => {
    writeSheetCache<Item>(context.spreadsheetId, 'Operacoes', [{ id: 'x', nome: 'VALE3' }])
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const item: Item = { id: 'a', nome: 'PETR4' }
    const returned = await wrapped.append(context, item)

    expect(returned).toBe(item)
    expect(repo.calls.append).toBe(0)
    expect(count()).toBe(1)
    expect(outboxList()[0]).toMatchObject({ sheet: 'Operacoes', kind: 'append' })
    expect(cachedRows<Item>('Operacoes')).toEqual([{ id: 'x', nome: 'VALE3' }, item])
  })

  it('append sem cache: só enfileira e a próxima leitura reaplica a pendência', async () => {
    const repo = createFakeRepo({ remoteRows: [{ id: 'remoto', nome: 'ITUB4' }] })
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const item: Item = { id: 'a', nome: 'PETR4' }
    await wrapped.append(context, item)

    // Sem cache não há como aplicar a linha sem esconder o resto da aba.
    expect(readSheetCache(context.spreadsheetId, 'Operacoes')).toBeNull()
    expect(count()).toBe(1)

    const rows = await wrapped.list(context)

    expect(repo.calls.refresh).toBe(1)
    expect(rows).toEqual([{ id: 'remoto', nome: 'ITUB4' }, item])
    expect(cachedRows<Item>('Operacoes')).toEqual([{ id: 'remoto', nome: 'ITUB4' }, item])
  })

  it('escrita sem rede usa a fila mesmo com a aba em cache', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    await wrapped.append(context, { id: 'a', nome: 'PETR4' })

    expect(repo.calls.append).toBe(0)
    expect(count()).toBe(1)
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

describe('withOfflineOutbox — escrita imediata (fluxos administrativos)', () => {
  it('comEscritaImediata: vai direto ao repositório real e não usa o outbox', async () => {
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    const item: Item = { id: 'a', nome: 'PETR4' }
    const returned = await comEscritaImediata(() => wrapped.append(context, item))

    expect(returned).toBe(item)
    expect(repo.calls.append).toBe(1)
    expect(count()).toBe(0)
    expect(readSheetCache(context.spreadsheetId, 'Operacoes')).toBeNull()
  })

  it('isEscritaImediata reflete a janela e volta ao normal ao terminar', async () => {
    let dentro = false
    await comEscritaImediata(async () => {
      dentro = isEscritaImediata()
      await Promise.resolve()
    })

    expect(dentro).toBe(true)
    expect(isEscritaImediata()).toBe(false)
  })

  it('erro do repositório real é propagado (sem fila) dentro da escrita imediata', async () => {
    const repo = createFakeRepo()
    const proxied = {
      ...repo,
      append: async () => {
        throw Object.assign(new Error('proibido'), { status: 403 })
      },
    }
    const wrapped = withOfflineOutbox(proxied, { idOf: (item) => item.id })

    await expect(
      comEscritaImediata(() => wrapped.append(context, { id: 'a', nome: 'PETR4' })),
    ).rejects.toMatchObject({ status: 403 })
    expect(count()).toBe(0)
  })
})

describe('withOfflineOutbox — modo local', () => {
  it('escreve direto no repositório e não enfileira', async () => {
    setModoArmazenamento(MODO_LOCAL)
    const repo = createFakeRepo()
    const wrapped = withOfflineOutbox(repo, { idOf: (item) => item.id })

    await wrapped.append(context, { id: 'a', nome: 'PETR4' })

    expect(repo.calls.append).toBe(1)
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

  it('operacoesRepo.append: enfileira sem chamar a API e atualiza um cache existente', async () => {
    const fetchSpy = vi.fn(() => {
      throw new TypeError('fetch não deveria ser chamado na escrita local-first')
    })
    vi.stubGlobal('fetch', fetchSpy)

    writeSheetCache<Operacao>(context.spreadsheetId, 'Operacoes', [])
    const operacao = operacaoBase()
    const returned = await operacoesRepo.append(context, operacao)

    expect(returned).toBe(operacao)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(count()).toBe(1)
    expect(outboxList()[0]).toMatchObject({ sheet: 'Operacoes', kind: 'append' })
    expect(readSheetCache<Operacao>(context.spreadsheetId, 'Operacoes')?.rows).toEqual([operacao])
  })

  it('operacoesRepo.append sem cache: enfileira e deixa a aba para a próxima leitura', async () => {
    const fetchSpy = vi.fn(() => {
      throw new TypeError('fetch não deveria ser chamado na escrita local-first')
    })
    vi.stubGlobal('fetch', fetchSpy)

    await operacoesRepo.append(context, operacaoBase())

    expect(count()).toBe(1)
    expect(readSheetCache<Operacao>(context.spreadsheetId, 'Operacoes')).toBeNull()
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
