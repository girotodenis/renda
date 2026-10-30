import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarCotacoesMaisRetorno,
  clearMaisRetornoCache,
  extrairCotacao,
  identificadorB3,
  lerCotacaoCache,
  urlCotacao,
} from '@/infrastructure/cotacoes/maisRetorno/cotacoesB3'

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

const resposta = {
  market: 'b3',
  currency: 'BRL',
  nicename: 'Petrobras PN',
  shortname: 'PETR4',
  quotes: [
    { d: '2026-10-27', c: 51.9, p: 1500000.5, q: 1250 },
    { d: '2026-10-28', c: 52.2, p: 1400000.0, q: 1100 },
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

const falha = { ok: false, status: 401, json: async () => ({}) } as unknown as Response

beforeEach(() => {
  armazenamento.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('identificadorB3 / urlCotacao', () => {
  it('monta o identifier `ticker:b3` em minúsculas', () => {
    expect(identificadorB3(' PETR4 ')).toBe('petr4:b3')
  })

  it('monta a url de /quotes com janela de datas e adjusted=false', () => {
    const url = urlCotacao('petr4:b3', new Date('2026-10-30T12:00:00Z'))
    expect(url).toContain('https://data.maisretorno.com/mr-data/v4/api/quotes/petr4%3Ab3?')
    expect(url).toContain('start_date=2026-10-10')
    expect(url).toContain('end_date=2026-10-30')
    expect(url).toContain('adjusted=false')
  })
})

describe('extrairCotacao', () => {
  it('usa o fechamento mais recente e o anterior como referência do dia', () => {
    expect(extrairCotacao(resposta)).toEqual({
      preco: 5220,
      precoAbertura: 5190,
      atualizadoEm: '2026-10-28',
      fonte: 'api',
    })
  })

  it('ordena a série por data antes de escolher o último fechamento', () => {
    const invertida = { quotes: [...resposta.quotes].reverse() }
    expect(extrairCotacao(invertida)).toMatchObject({
      preco: 5220,
      atualizadoEm: '2026-10-28',
    })
  })

  it('sem fechamento anterior, a referência do dia fica nula', () => {
    expect(extrairCotacao({ quotes: [{ d: '2026-10-28', c: 52.2 }] })).toMatchObject({
      preco: 5220,
      precoAbertura: null,
    })
  })

  it('aceita preço em texto e ignora itens inválidos', () => {
    const payload = { quotes: [{ d: '2026-10-28', c: '52,20' }, { d: null, c: 10 }, null] }
    expect(extrairCotacao(payload)?.preco).toBe(5220)
  })

  it('retorna null para respostas de erro ou vazias', () => {
    expect(extrairCotacao({ error: true })).toBeNull()
    expect(extrairCotacao({ quotes: [] })).toBeNull()
    expect(extrairCotacao({ quotes: [{ d: '2026-10-28', c: 0 }] })).toBeNull()
    expect(extrairCotacao(null)).toBeNull()
  })
})

describe('atualizarCotacoesMaisRetorno', () => {
  it('sem token não toca a rede e devolve os tickers sem cotação', async () => {
    const fetchSpy = stubFetch(() => ok(resposta))

    const resultado = await atualizarCotacoesMaisRetorno(['PETR4'], { token: '' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({ semCotacao: ['PETR4'], semToken: true, consultouRede: false })
  })

  it('consulta a API com X-Api-Key e devolve a cotação em centavos', async () => {
    const fetchSpy = stubFetch(() => ok(resposta))

    const resultado = await atualizarCotacoesMaisRetorno(['PETR4'], { token: ' mr_abc ' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toContain('/quotes/petr4%3Ab3?')
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('mr_abc')
    expect(resultado.cotacoes.get('PETR4')).toMatchObject({ preco: 5220, fonte: 'api' })
    expect(resultado).toMatchObject({ semCotacao: [], semToken: false, consultouRede: true })
  })

  it('usa o cache nas chamadas seguintes (1 crédito por ticker)', async () => {
    const fetchSpy = stubFetch(() => ok(resposta))
    await atualizarCotacoesMaisRetorno(['PETR4'], { token: 'mr_abc' })

    const segunda = await atualizarCotacoesMaisRetorno(['PETR4'], { token: 'mr_abc' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(segunda.cotacoes.get('PETR4')).toMatchObject({ preco: 5220, fonte: 'cache' })
  })

  it('forceRefresh ignora o cache', async () => {
    const fetchSpy = stubFetch(() => ok(resposta))
    await atualizarCotacoesMaisRetorno(['PETR4'], { token: 'mr_abc' })
    await atualizarCotacoesMaisRetorno(['PETR4'], { token: 'mr_abc', forceRefresh: true })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('expira o cache depois de 90 min', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
    stubFetch(() => ok(resposta))
    await atualizarCotacoesMaisRetorno(['PETR4'], { token: 'mr_abc' })
    expect(lerCotacaoCache('PETR4')).not.toBeNull()

    vi.setSystemTime(new Date('2026-10-28T13:31:00Z'))
    expect(lerCotacaoCache('PETR4')).toBeNull()
  })

  it('registra falhas por ticker sem interromper os demais', async () => {
    stubFetch((url) => (url.includes('petr4') ? falha : ok({ quotes: [{ d: '2026-10-28', c: 10 }] })))

    const resultado = await atualizarCotacoesMaisRetorno(['PETR4', 'VALE3'], { token: 'mr_abc' })

    expect(resultado.cotacoes.get('VALE3')).toMatchObject({ preco: 1000 })
    expect(resultado.semCotacao).toEqual(['PETR4'])
  })

  it('clearMaisRetornoCache limpa as cotações gravadas', async () => {
    stubFetch(() => ok(resposta))
    await atualizarCotacoesMaisRetorno(['PETR4'], { token: 'mr_abc' })
    clearMaisRetornoCache()
    expect(lerCotacaoCache('PETR4')).toBeNull()
  })
})
