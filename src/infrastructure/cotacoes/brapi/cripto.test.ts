import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarCotacoesCriptoBrapi,
  clearBrapiCriptoCache,
  extrairCotacoesCripto,
  lerCotacaoCriptoCache,
} from '@/infrastructure/cotacoes/brapi/cripto'

const armazenamento = new Map<string, string>()

vi.mock('@/infrastructure/storage', () => ({
  readStorageJson: (chave: string) => {
    const valor = armazenamento.get(chave)
    return valor === undefined ? null : JSON.parse(valor)
  },
  writeStorageJson: (chave: string, valor: unknown) => {
    armazenamento.set(chave, JSON.stringify(valor))
  },
  clearStorageKeys: (prefixo: string) => {
    for (const chave of [...armazenamento.keys()]) {
      if (chave.startsWith(prefixo)) armazenamento.delete(chave)
    }
  },
}))

const payload = {
  coins: [
    {
      coin: 'BTC',
      currency: 'BRL',
      regularMarketPrice: 350000,
      regularMarketChangePercent: 25,
      regularMarketTime: '2026-10-28T16:24:00.000Z',
    },
    { coin: 'eth', currency: 'BRL', regularMarketPrice: 20000 },
    { coin: 'SEMPRECO', currency: 'BRL', regularMarketPrice: null },
  ],
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => impl(url, init))
  vi.stubGlobal('fetch', spy)
  return spy
}

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const falha = { ok: false, status: 400, json: async () => ({}) } as unknown as Response

beforeEach(() => {
  armazenamento.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('extrairCotacoesCripto', () => {
  it('extrai sigla → preço em centavos da resposta da Brapi', () => {
    const cotacoes = extrairCotacoesCripto(payload)

    expect(cotacoes.get('BTC')).toMatchObject({
      preco: 35000000,
      atualizadoEm: '2026-10-28',
      fonte: 'api',
    })
    expect(cotacoes.get('ETH')?.preco).toBe(2000000)
  })

  it('deriva a abertura (fechamento anterior) da variação de 24 h', () => {
    // 350000 / (1 + 25/100) = 280000
    expect(extrairCotacoesCripto(payload).get('BTC')?.precoAbertura).toBe(28000000)
    // Sem variação a abertura fica nula (variação não é exibida).
    expect(extrairCotacoesCripto(payload).get('ETH')?.precoAbertura).toBeNull()
  })

  it('ignora registros sem preço e payloads inesperados', () => {
    expect(extrairCotacoesCripto(payload).has('SEMPRECO')).toBe(false)
    expect(extrairCotacoesCripto(null).size).toBe(0)
    expect(extrairCotacoesCripto({ coins: 'nope' }).size).toBe(0)
    expect(extrairCotacoesCripto({ error: true, coins: [] }).size).toBe(0)
  })
})

describe('atualizarCotacoesCriptoBrapi', () => {
  it('sem token não toca a rede e devolve os tickers sem cotação', async () => {
    const fetchSpy = stubFetch(() => ok(payload))

    const resultado = await atualizarCotacoesCriptoBrapi(['BTC'])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({ semCotacao: ['BTC'], semToken: true, consultouRede: false })
  })

  it('consulta /api/v2/crypto em BRL com token', async () => {
    const fetchSpy = stubFetch(() => ok(payload))

    const resultado = await atualizarCotacoesCriptoBrapi(['btc'], { token: ' tk ' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = String(fetchSpy.mock.calls[0]![0])
    expect(url).toContain('https://brapi.dev/api/v2/crypto?')
    expect(url).toContain('coin=BTC')
    expect(url).toContain('currency=BRL')
    expect(url).toContain('token=tk')
    expect(resultado.cotacoes.get('BTC')?.preco).toBe(35000000)
    expect(resultado).toMatchObject({ semCotacao: [], semToken: false, consultouRede: true })
  })

  it('usa o cache nas chamadas seguintes', async () => {
    const fetchSpy = stubFetch(() => ok(payload))
    await atualizarCotacoesCriptoBrapi(['BTC'], { token: 'tk' })

    const segunda = await atualizarCotacoesCriptoBrapi(['BTC'], { token: 'tk' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(segunda.cotacoes.get('BTC')?.fonte).toBe('cache')
  })

  it('forceRefresh ignora o cache', async () => {
    const fetchSpy = stubFetch(() => ok(payload))
    await atualizarCotacoesCriptoBrapi(['BTC'], { token: 'tk' })
    await atualizarCotacoesCriptoBrapi(['BTC'], { token: 'tk', forceRefresh: true })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('expira o cache depois de 15 min', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
    stubFetch(() => ok(payload))
    await atualizarCotacoesCriptoBrapi(['BTC'], { token: 'tk' })
    expect(lerCotacaoCriptoCache('BTC')).not.toBeNull()

    vi.setSystemTime(new Date('2026-10-28T12:16:00Z'))
    expect(lerCotacaoCriptoCache('BTC')).toBeNull()
  })

  it('registra falhas por moeda sem interromper as demais', async () => {
    stubFetch((url) =>
      url.includes('coin=BTC') ? falha : ok({ coins: [{ coin: 'ETH', regularMarketPrice: 100 }] }),
    )

    const resultado = await atualizarCotacoesCriptoBrapi(['BTC', 'ETH'], { token: 'tk' })

    expect(resultado.cotacoes.get('ETH')?.preco).toBe(10000)
    expect(resultado.semCotacao).toEqual(['BTC'])
  })

  it('clearBrapiCriptoCache limpa as cotações gravadas', async () => {
    stubFetch(() => ok(payload))
    await atualizarCotacoesCriptoBrapi(['BTC'], { token: 'tk' })

    clearBrapiCriptoCache()

    expect(lerCotacaoCriptoCache('BTC')).toBeNull()
  })
})
