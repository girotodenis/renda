import { describe, expect, it } from 'vitest'
import { CategoriaAtivo } from '@/domain/entities'
import { CATALOGO_CRIPTO, CATALOGO_TESOURO_DIRETO, montarSugestoesTicker } from '@/domain/tickers'

describe('montarSugestoesTicker', () => {
  it('prioriza os tickers da carteira da mesma categoria e remove duplicatas', () => {
    const sugestoes = montarSugestoesTicker(
      CategoriaAtivo.Acao,
      [
        { ticker: 'VALE3', categoria: CategoriaAtivo.Acao },
        { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii },
        { ticker: 'vale3', categoria: CategoriaAtivo.Acao },
      ],
      ['PETR4', 'VALE3', 'ABEV3'],
    )
    expect(sugestoes).toEqual(['VALE3', 'ABEV3', 'PETR4'])
  })

  it('mantém a grafia da carteira para títulos do Tesouro', () => {
    const sugestoes = montarSugestoesTicker(
      CategoriaAtivo.TesouroDireto,
      [{ ticker: 'TESOURO SELIC 2029', categoria: CategoriaAtivo.TesouroDireto }],
      CATALOGO_TESOURO_DIRETO,
    )
    expect(sugestoes[0]).toBe('TESOURO SELIC 2029')
    expect(sugestoes).not.toContain('Tesouro Selic 2029')
    expect(sugestoes).toContain('Tesouro IPCA+ 2035')
  })
})

describe('CATALOGO_TESOURO_DIRETO', () => {
  it('contém as famílias de títulos sem duplicatas', () => {
    expect(CATALOGO_TESOURO_DIRETO).toEqual(
      expect.arrayContaining([
        'Tesouro Selic 2029',
        'Tesouro Prefixado 2031',
        'Tesouro Prefixado com Juros Semestrais 2035',
        'Tesouro IPCA+ com Juros Semestrais 2045',
        'Tesouro Renda+ Aposentadoria Extra 2065',
        'Tesouro Educa+ 2035',
      ]),
    )
    expect(new Set(CATALOGO_TESOURO_DIRETO).size).toBe(CATALOGO_TESOURO_DIRETO.length)
  })
})

describe('CATALOGO_CRIPTO', () => {
  it('contém as principais siglas sem duplicatas', () => {
    expect(CATALOGO_CRIPTO).toEqual(expect.arrayContaining(['BTC', 'ETH', 'USDT', 'SOL']))
    expect(new Set(CATALOGO_CRIPTO).size).toBe(CATALOGO_CRIPTO.length)
  })

  it('mantém a grafia da carteira nas sugestões de cripto', () => {
    const sugestoes = montarSugestoesTicker(
      CategoriaAtivo.Cripto,
      [{ ticker: 'btc', categoria: CategoriaAtivo.Cripto }],
      CATALOGO_CRIPTO,
    )
    expect(sugestoes[0]).toBe('btc')
    expect(sugestoes.filter((ticker) => ticker.toUpperCase() === 'BTC')).toEqual(['btc'])
  })
})
