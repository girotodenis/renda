import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarCotacoesTesouroMaisRetorno,
  clearMaisRetornoTesouroCache,
  extrairTitulosTesouro,
  lerCotacoesTesouroCache,
} from '@/infrastructure/cotacoes/maisRetorno/tesouro'

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

const busca = [
  { identifier: 'tesouro-selic-01-03-2029:td', nicename: 'Tesouro Selic 2029', type: 'td', has_quotes: true },
  { identifier: 'tesouro-ipca-15-05-2035:td', nicename: 'Tesouro IPCA+ 2035', type: 'td', has_quotes: true },
  { identifier: 'ntn-r2-15-02-2004-brstncntr084:tp', nicename: 'NTN-R2', type: 'tp', has_quotes: true },
  { identifier: 'sem-data:td', nicename: 'Inválido', type: 'td', has_quotes: true },
]

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

function stubFetch(impl: (url: string) => Response) {
  const spy = vi.fn(async (url: string) => impl(url))
  vi.stubGlobal('fetch', spy)
  return spy
}

const cotacao = (preco: number, d = '2026-10-28') => ({ market: 'td', quotes: [{ d, c: preco }] })

beforeEach(() => {
  armazenamento.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extrairTitulosTesouro (Mais Retorno)', () => {
  it('lê o vencimento e o nome do identifier e ignora outros mercados', () => {
    expect(extrairTitulosTesouro(busca)).toEqual([
      {
        symbol: 'tesouro-selic-01-03-2029',
        bondType: 'Tesouro Selic',
        maturityDate: '2029-03-01',
        preco: 0,
        dataBase: null,
      },
      {
        symbol: 'tesouro-ipca-15-05-2035',
        bondType: 'Tesouro Ipca',
        maturityDate: '2035-05-15',
        preco: 0,
        dataBase: null,
      },
    ])
  })

  it('retorna vazio para respostas inesperadas', () => {
    expect(extrairTitulosTesouro({ error: true })).toEqual([])
    expect(extrairTitulosTesouro(null)).toEqual([])
  })
})

describe('atualizarCotacoesTesouroMaisRetorno', () => {
  const titulos = [
    { ticker: 'Tesouro Selic 2029', vencimento: '2029-03-01' },
    { ticker: 'Tesouro IPCA+ 2035', vencimento: null },
  ]

  it('sem token não consulta a API', async () => {
    const fetchSpy = stubFetch(() => ok(busca))

    const resultado = await atualizarCotacoesTesouroMaisRetorno(titulos, { token: '' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({
      semCotacao: ['Tesouro Selic 2029', 'Tesouro IPCA+ 2035'],
      semToken: true,
      consultouRede: false,
    })
  })

  it('casa os tickers e busca o preço só dos títulos da carteira', async () => {
    const fetchSpy = stubFetch((url) =>
      url.includes('/search/') ? ok(busca) : ok(cotacao(18000.5)),
    )

    const resultado = await atualizarCotacoesTesouroMaisRetorno(titulos, { token: 'mr_abc' })

    const urls = fetchSpy.mock.calls.map(([url]) => url)
    expect(urls[0]).toContain('/search/tesouro?has_quotes=true')
    expect(urls.filter((url) => url.includes('/quotes/'))).toHaveLength(2)
    expect(urls.some((url) => url.includes('tesouro-selic-01-03-2029%3Atd'))).toBe(true)
    expect(resultado.cotacoes.get('Tesouro Selic 2029')).toMatchObject({
      preco: 1800050,
      precoAbertura: null,
      atualizadoEm: '2026-10-28',
    })
    expect(resultado.semCotacao).toEqual([])
    expect(resultado.consultouRede).toBe(true)
  })

  it('reaproveita a lista e os preços do cache', async () => {
    const fetchSpy = stubFetch((url) =>
      url.includes('/search/') ? ok(busca) : ok(cotacao(18000.5)),
    )
    await atualizarCotacoesTesouroMaisRetorno(titulos, { token: 'mr_abc' })
    fetchSpy.mockClear()

    const segunda = await atualizarCotacoesTesouroMaisRetorno(titulos, { token: 'mr_abc' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(segunda.cotacoes.get('Tesouro Selic 2029')).toMatchObject({ fonte: 'cache' })
  })

  it('ticker sem título correspondente fica sem cotação', async () => {
    stubFetch((url) => (url.includes('/search/') ? ok(busca) : ok(cotacao(18000.5))))

    const resultado = await atualizarCotacoesTesouroMaisRetorno(
      [{ ticker: 'Tesouro Selic 2044', vencimento: null }],
      { token: 'mr_abc' },
    )

    expect(resultado).toMatchObject({ semCotacao: ['Tesouro Selic 2044'], semToken: false })
  })

  it('falha na busca deixa todos os títulos sem cotação', async () => {
    stubFetch(() => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response)

    const resultado = await atualizarCotacoesTesouroMaisRetorno(titulos, { token: 'mr_abc' })

    expect(resultado.semCotacao).toEqual(['Tesouro Selic 2029', 'Tesouro IPCA+ 2035'])
    expect(resultado.consultouRede).toBe(true)
  })

  it('lerCotacoesTesouroCache usa a lista e os preços gravados', async () => {
    stubFetch((url) => (url.includes('/search/') ? ok(busca) : ok(cotacao(18000.5))))
    await atualizarCotacoesTesouroMaisRetorno(titulos, { token: 'mr_abc' })

    expect(lerCotacoesTesouroCache(titulos).get('Tesouro Selic 2029')).toMatchObject({
      preco: 1800050,
      fonte: 'cache',
    })

    clearMaisRetornoTesouroCache()
    expect(lerCotacoesTesouroCache(titulos).size).toBe(0)
  })
})
