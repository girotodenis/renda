import { describe, expect, it } from 'vitest'
import { extrairCotacoes, lerCotacaoCache } from '@/services/brapi'

/** Testes do parser/serviço de cotação B3 via Brapi (fallback do GOOGLEFINANCE). */

const payloadBrapi = {
  error: false,
  results: [
    { symbol: 'PETR4', regularMarketPrice: 123.45, regularMarketTime: '2026-10-10T17:30:00.000Z' },
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
