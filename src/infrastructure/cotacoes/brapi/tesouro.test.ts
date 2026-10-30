import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarCotacoesTesouroBrapi,
  clearBrapiTesouroCache,
  lerCotacoesTesouroCache,
} from '@/infrastructure/cotacoes/brapi/tesouro'

/** Testes do serviço de preços do Tesouro Direto via Brapi (`/treasury/list`). */

function instalarLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      get length() {
        return store.size
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  })
}

function resposta(results: unknown[], hasNextPage = false): Response {
  return new Response(
    JSON.stringify({ results, pagination: { page: 1, limit: 100, hasNextPage } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

const selic2029 = {
  symbol: 'tesouro-selic-01032029',
  bondType: 'Tesouro Selic',
  maturityDate: '2029-03-01',
  baseDate: '2026-10-28',
  sellPrice: 18000.5,
}
const ipca2035 = {
  symbol: 'tesouro-ipca-15052035',
  bondType: 'Tesouro IPCA+',
  maturityDate: '2035-05-15',
  baseDate: '2026-10-28',
  sellPrice: 2100,
}

const carteira = [
  { ticker: 'Tesouro Selic 2029', vencimento: null },
  { ticker: 'Tesouro IPCA+ 2035', vencimento: '2035-05-15' },
  { ticker: 'Tesouro Prefixado 2027', vencimento: null },
]

describe('atualizarCotacoesTesouroBrapi', () => {
  beforeEach(() => instalarLocalStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('sem token não consulta a rede', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await atualizarCotacoesTesouroBrapi(carteira)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(resultado.semToken).toBe(true)
    expect(resultado.semCotacao).toEqual(carteira.map(({ ticker }) => ticker))
  })

  it('pagina a listagem, casa os tickers e guarda em cache', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('page=1') ? resposta([selic2029], true) : resposta([ipca2035]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await atualizarCotacoesTesouroBrapi(carteira, { token: 'tk' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v2/treasury/list?page=1')
    expect(resultado.consultouRede).toBe(true)
    expect(resultado.cotacoes.get('Tesouro Selic 2029')).toMatchObject({
      preco: 1800050,
      atualizadoEm: '2026-10-28',
      fonte: 'api',
    })
    expect(resultado.cotacoes.get('Tesouro IPCA+ 2035')?.preco).toBe(210000)
    expect(resultado.semCotacao).toEqual(['Tesouro Prefixado 2027'])

    expect(lerCotacoesTesouroCache(carteira).get('Tesouro Selic 2029')?.fonte).toBe('cache')
    const doCache = await atualizarCotacoesTesouroBrapi(carteira, { token: 'tk' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(doCache.consultouRede).toBe(false)

    clearBrapiTesouroCache()
    expect(lerCotacoesTesouroCache(carteira).size).toBe(0)
  })

  it('falha da API (ex.: plano sem Tesouro) deixa tudo sem cotação, sem lançar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":true}', { status: 403 })),
    )

    const resultado = await atualizarCotacoesTesouroBrapi(carteira, {
      token: 'tk',
      forceRefresh: true,
    })

    expect(resultado.cotacoes.size).toBe(0)
    expect(resultado.semCotacao).toHaveLength(3)
    expect(resultado.semToken).toBe(false)
  })
})
