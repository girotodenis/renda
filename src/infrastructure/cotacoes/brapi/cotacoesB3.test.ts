import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarCotacoesBrapi,
  buscarCotacoesBrapi,
  extrairCotacoes,
  lerCotacaoCache,
} from '@/infrastructure/cotacoes/brapi/cotacoesB3'

/** Testes do parser/serviço de cotação B3 via Brapi (fallback do GOOGLEFINANCE). */

const payloadBrapi = {
  error: false,
  results: [
    {
      symbol: 'PETR4',
      regularMarketPrice: 123.45,
      regularMarketOpen: 120,
      regularMarketTime: '2026-10-10T17:30:00.000Z',
    },
    { symbol: 'HGLG11', regularMarketPrice: 150.5, regularMarketTime: '2026-10-10T17:30:00.000Z' },
    { symbol: 'SEMPRECO', regularMarketPrice: null, regularMarketTime: null },
  ],
}

describe('extrairCotacoes', () => {
  it('extrai ticker → preço em centavos da resposta da Brapi', () => {
    const cotacoes = extrairCotacoes(payloadBrapi)
    expect(cotacoes.get('PETR4')).toMatchObject({
      preco: 12345,
      atualizadoEm: '2026-10-10',
      fonte: 'api',
    })
    expect(cotacoes.get('HGLG11')?.preco).toBe(15050)
  })

  it('normaliza o ticker para maiúsculas', () => {
    const cotacoes = extrairCotacoes({
      results: [{ symbol: 'petr4', regularMarketPrice: 10 }],
    })
    expect(cotacoes.get('PETR4')?.preco).toBe(1000)
  })

  it('ignora registros sem preço', () => {
    expect(extrairCotacoes(payloadBrapi).has('SEMPRECO')).toBe(false)
  })

  it('extrai a abertura do dia (regularMarketOpen) em centavos', () => {
    expect(extrairCotacoes(payloadBrapi).get('PETR4')?.precoAbertura).toBe(12000)
    // Sem `regularMarketOpen` a abertura fica nula (variação não é exibida).
    expect(extrairCotacoes(payloadBrapi).get('HGLG11')?.precoAbertura).toBeNull()
  })

  it('retorna mapa vazio para payloads inesperados', () => {
    expect(extrairCotacoes(null).size).toBe(0)
    expect(extrairCotacoes({ results: 'nope' }).size).toBe(0)
    expect(extrairCotacoes({ error: true, results: [] }).size).toBe(0)
  })
})

describe('lerCotacaoCache', () => {
  it('retorna null quando não há cache (ambiente sem LocalStorage)', () => {
    expect(lerCotacaoCache('PETR4')).toBeNull()
  })
})

/** `localStorage` mínimo para o cache de cotações no ambiente `node`. */
function instalarLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  })
}

describe('atualizarCotacoesBrapi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sem token, desliga a rede e informa o que ficou sem cotação', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await atualizarCotacoesBrapi(['PETR4', 'VALE3'])

    expect(resultado.semToken).toBe(true)
    expect(resultado.consultouRede).toBe(false)
    expect(resultado.cotacoes.size).toBe(0)
    expect(resultado.semCotacao).toEqual(['PETR4', 'VALE3'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consulta um ticker por vez e devolve preço + abertura', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const ticker = String(input).includes('VALE3') ? 'VALE3' : 'PETR4'
      const preco = ticker === 'VALE3' ? 60 : 123.45
      return new Response(
        JSON.stringify({
          error: false,
          results: [{ symbol: ticker, regularMarketPrice: preco, regularMarketOpen: preco - 1 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await atualizarCotacoesBrapi(['PETR4', 'VALE3'], { token: 'tk' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resultado.semToken).toBe(false)
    expect(resultado.consultouRede).toBe(true)
    expect(resultado.semCotacao).toEqual([])
    expect(resultado.cotacoes.get('PETR4')).toMatchObject({ preco: 12345, precoAbertura: 12245 })
    expect(resultado.cotacoes.get('VALE3')?.preco).toBe(6000)
  })

  it('registra falha individual sem interromper os demais tickers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('VALE3')
        ? new Response('erro', { status: 500 })
        : new Response(
            JSON.stringify({ results: [{ symbol: 'PETR4', regularMarketPrice: 10 }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await atualizarCotacoesBrapi(['PETR4', 'VALE3'], { token: 'tk' })

    expect(resultado.cotacoes.get('PETR4')?.preco).toBe(1000)
    expect(resultado.semCotacao).toEqual(['VALE3'])
  })

  it('forceRefresh ignora o cache e consulta a API de novo', async () => {
    instalarLocalStorage()
    let preco = 20
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [{ symbol: 'PETR4', regularMarketPrice: preco }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    // 1ª consulta: rede e gravação no cache.
    await atualizarCotacoesBrapi(['PETR4'], { token: 'tk' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Sem forceRefresh: cache válido, sem nova requisição.
    const cache = await atualizarCotacoesBrapi(['PETR4'], { token: 'tk' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.cotacoes.get('PETR4')?.fonte).toBe('cache')

    // Com forceRefresh: busca o preço novo.
    preco = 25
    const forcado = await atualizarCotacoesBrapi(['PETR4'], { token: 'tk', forceRefresh: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(forcado.cotacoes.get('PETR4')).toMatchObject({ preco: 2500, fonte: 'api' })
  })

  it('notifica cada ticker e para as requisições quando o sinal é cancelado', async () => {
    instalarLocalStorage()
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => {
      controller.abort()
      return new Response(
        JSON.stringify({ results: [{ symbol: 'PETR4', regularMarketPrice: 20 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const vistos: string[] = []
    await atualizarCotacoesBrapi(['PETR4', 'VALE3'], {
      token: 'tk',
      signal: controller.signal,
      onTicker: (ticker) => vistos.push(ticker),
    })

    expect(vistos).toEqual(['PETR4', 'VALE3'])
    // O cancelamento durante a 1ª requisição impede a consulta dos demais.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('buscarCotacoesBrapi continua devolvendo apenas os preços', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ results: [{ symbol: 'PETR4', regularMarketPrice: 30 }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )

    expect(await buscarCotacoesBrapi(['PETR4'], { token: 'tk' })).toEqual(new Map([['PETR4', 3000]]))
  })
})
