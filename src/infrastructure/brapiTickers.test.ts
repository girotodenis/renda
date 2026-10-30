import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo } from '@/domain/entities'
import { extrairTickersBrapi, listarTickersBrapi } from '@/infrastructure/brapiTickers'

/** Testes da lista de tickers B3 (autocomplete do cadastro de operações). */

const payloadFund = {
  stocks: [
    { stock: 'MXRF11', type: 'fund', subType: 'fii' },
    { stock: 'BOVA11', type: 'fund', subType: 'etf' },
    { stock: 'kncr11', type: 'fund', subType: 'fi-infra' },
    { stock: '', type: 'fund', subType: 'fii' },
    { stock: 'XPTO1', type: 'desconhecido' },
  ],
}

describe('extrairTickersBrapi', () => {
  it('separa FII e ETF pelo subType e normaliza o código', () => {
    const resultado = extrairTickersBrapi(payloadFund)
    expect(resultado.get(CategoriaAtivo.Fii)).toEqual(['MXRF11', 'KNCR11'])
    expect(resultado.get(CategoriaAtivo.Etf)).toEqual(['BOVA11'])
  })

  it('mapeia stock → Ação e bdr → BDR', () => {
    const resultado = extrairTickersBrapi({
      stocks: [
        { stock: 'PETR4', type: 'stock', subType: 'stock' },
        { stock: 'BPAC11', type: 'stock', subType: 'unit' },
        { stock: 'PETR4F', type: 'stock', subType: 'stock' },
        { stock: 'AAPL34', type: 'bdr', subType: 'bdr' },
      ],
    })
    expect(resultado.get(CategoriaAtivo.Acao)).toEqual(['PETR4', 'BPAC11'])
    expect(resultado.get(CategoriaAtivo.Bdr)).toEqual(['AAPL34'])
  })

  it('ignora respostas de erro ou fora do formato', () => {
    expect(extrairTickersBrapi({ error: true, stocks: [] }).size).toBe(0)
    expect(extrairTickersBrapi(null).size).toBe(0)
    expect(extrairTickersBrapi({ stocks: 'x' }).size).toBe(0)
  })
})

describe('listarTickersBrapi', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('consulta sem token e reaproveita o cache entre FII e ETF', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payloadFund)))
    vi.stubGlobal('fetch', fetchMock)

    expect(await listarTickersBrapi(CategoriaAtivo.Fii)).toEqual(['MXRF11', 'KNCR11'])
    expect(await listarTickersBrapi(CategoriaAtivo.Etf)).toEqual(['BOVA11'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('type=fund')
    expect(url).not.toContain('token')
  })

  it('não consulta a rede para Tesouro Direto e Renda Fixa', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await listarTickersBrapi(CategoriaAtivo.TesouroDireto)).toEqual([])
    expect(await listarTickersBrapi(CategoriaAtivo.RendaFixa)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha de rede sem cache devolve lista vazia (nunca lança)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    expect(await listarTickersBrapi(CategoriaAtivo.Acao)).toEqual([])
  })

  it('falha de rede com cache vencido usa o cache', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ stocks: [{ stock: 'PETR4', type: 'stock' }] })),
      ),
    )
    expect(await listarTickersBrapi(CategoriaAtivo.Acao)).toEqual(['PETR4'])

    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'))
    const falha = vi.fn(async () => new Response('erro', { status: 429 }))
    vi.stubGlobal('fetch', falha)
    expect(await listarTickersBrapi(CategoriaAtivo.Acao)).toEqual(['PETR4'])
    expect(falha).toHaveBeenCalledTimes(1)
  })
})
