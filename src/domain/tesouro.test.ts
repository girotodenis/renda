import { describe, expect, it } from 'vitest'
import { encontrarTituloTesouro } from '@/domain/tesouro'
import { extrairTitulosTesouro } from '@/infrastructure/cotacoes/brapi/tesouro'

function item(symbol: string, bondType: string, maturityDate: string, sellPrice: number) {
  return { symbol, bondType, maturityDate, baseDate: '2026-10-28', sellPrice, basePrice: sellPrice }
}

const payload = {
  results: [
    item('tesouro-selic-01032029', 'Tesouro Selic', '2029-03-01', 18000.5),
    item('tesouro-selic-01032031', 'Tesouro Selic', '2031-03-01', 20082.38),
    item('tesouro-ipca-15052035', 'Tesouro IPCA+', '2035-05-15', 2100),
    item('tesouro-ipca-com-juros-semestrais-15052035', 'Tesouro IPCA+ com Juros Semestrais', '2035-05-15', 4300),
    item('tesouro-renda-aposentadoria-extra-15122065', 'Tesouro Renda+ Aposentadoria Extra', '2065-12-15', 650),
    item('tesouro-educa-15122035', 'Tesouro Educa+', '2035-12-15', 3100),
    { symbol: 'sem-preco', bondType: 'X', maturityDate: '2030-01-01', sellPrice: null },
  ],
}

const titulos = extrairTitulosTesouro(payload)

describe('extrairTitulosTesouro', () => {
  it('converte o preço de resgate em centavos e ignora itens inválidos', () => {
    expect(titulos).toHaveLength(6)
    expect(titulos[1]).toEqual({
      symbol: 'tesouro-selic-01032031',
      bondType: 'Tesouro Selic',
      maturityDate: '2031-03-01',
      preco: 2008238,
      dataBase: '2026-10-28',
    })
  })

  it('retorna vazio para respostas de erro', () => {
    expect(extrairTitulosTesouro({ error: true, message: 'MISSING_TOKEN' })).toEqual([])
    expect(extrairTitulosTesouro(null)).toEqual([])
  })
})

describe('encontrarTituloTesouro', () => {
  const symbolDe = (ticker: string, vencimento: string | null = null) =>
    encontrarTituloTesouro(ticker, titulos, vencimento)?.symbol ?? null

  it('casa família + ano, sem diferenciar caixa', () => {
    expect(symbolDe('Tesouro Selic 2029')).toBe('tesouro-selic-01032029')
    expect(symbolDe('TESOURO SELIC 2031')).toBe('tesouro-selic-01032031')
  })

  it('distingue IPCA+ de IPCA+ com Juros Semestrais no mesmo ano', () => {
    expect(symbolDe('Tesouro IPCA+ 2035')).toBe('tesouro-ipca-15052035')
    expect(symbolDe('Tesouro IPCA+ com Juros Semestrais 2035')).toBe(
      'tesouro-ipca-com-juros-semestrais-15052035',
    )
  })

  it('aceita nome abreviado quando o casamento é único', () => {
    expect(symbolDe('Tesouro Renda+ 2065')).toBe('tesouro-renda-aposentadoria-extra-15122065')
    expect(symbolDe('Tesouro Educa+ 2035')).toBe('tesouro-educa-15122035')
  })

  it('aceita data completa no ticker, siglas antigas e o symbol da Brapi', () => {
    expect(symbolDe('Tesouro Selic 01/03/2031')).toBe('tesouro-selic-01032031')
    expect(symbolDe('NTN-B Principal 15/05/2035')).toBe('tesouro-ipca-15052035')
    expect(symbolDe('LFT 2029')).toBe('tesouro-selic-01032029')
    expect(symbolDe('tesouro-selic-01032031')).toBe('tesouro-selic-01032031')
  })

  it('usa o vencimento da operação e recusa casamentos inexistentes/ambíguos', () => {
    expect(symbolDe('Tesouro Selic 2029', '2029-03-01')).toBe('tesouro-selic-01032029')
    expect(symbolDe('Tesouro Selic 2029', '2029-09-01')).toBe('tesouro-selic-01032029')
    expect(symbolDe('Tesouro Selic 01/09/2029')).toBeNull()
    expect(symbolDe('Tesouro Selic 2040')).toBeNull()
    expect(symbolDe('Tesouro 2035')).toBeNull()
    expect(symbolDe('CDB Banco X')).toBeNull()
  })
})
