import { describe, expect, it } from 'vitest'
import { CategoriaAtivo } from '@/domain/entities'
import type { Consolidado, Valuation } from '@/domain/entities'
import {
  limiteDeCompra,
  oportunidadeDeCompra,
  tickersComOportunidade,
} from '@/domain/valuation'

/**
 * Testes da regra de oportunidade de compra (alerta de valuation):
 * `cotação ≤ preço teto − (preço teto × margem ÷ 100)`.
 */

function valuation(partial: Partial<Valuation> & { ticker: string }): Valuation {
  return {
    categoria: partial.categoria ?? CategoriaAtivo.Acao,
    precoTeto: partial.precoTeto ?? null,
    margemSeguranca: partial.margemSeguranca ?? null,
    anotacoes: partial.anotacoes ?? '',
    fclAtual: partial.fclAtual ?? null,
    dividaLiquida: partial.dividaLiquida ?? null,
    acoesMilhoes: partial.acoesMilhoes ?? null,
    crescimentoAno: partial.crescimentoAno ?? null,
    taxaDesconto: partial.taxaDesconto ?? null,
    anosProjecao: partial.anosProjecao ?? null,
    crescimentoPerpetuidade: partial.crescimentoPerpetuidade ?? null,
    ...partial,
  }
}

function consolidado(partial: Partial<Consolidado> & { ticker: string }): Consolidado {
  return {
    categoria: partial.categoria ?? CategoriaAtivo.Acao,
    quantidadeAtual: partial.quantidadeAtual ?? 1,
    precoMedio: partial.precoMedio ?? 0,
    precoAtual: partial.precoAtual ?? 0,
    totalInvestido: partial.totalInvestido ?? 0,
    valorAtual: partial.valorAtual ?? 0,
    lucroPrejuizo: partial.lucroPrejuizo ?? 0,
    lucroPrejuizoPercent: partial.lucroPrejuizoPercent ?? 0,
    percentualCarteira: partial.percentualCarteira ?? 0,
    ...partial,
  }
}

describe('limiteDeCompra', () => {
  it('calcula teto 100 e margem 20% → 80', () => {
    expect(limiteDeCompra(10000, 20)).toBe(8000)
  })

  it('calcula margem 0% → teto inalterado', () => {
    expect(limiteDeCompra(10000, 0)).toBe(10000)
  })

  it('calcula margem 100% → limite zero', () => {
    expect(limiteDeCompra(10000, 100)).toBe(0)
  })
})

describe('oportunidadeDeCompra', () => {
  it('exemplo da especificação: R$ 85 > R$ 80 → sem oportunidade', () => {
    expect(oportunidadeDeCompra(8500, 10000, 20)).toBe(false)
  })

  it('exemplo da especificação: R$ 78 ≤ R$ 80 → oportunidade', () => {
    expect(oportunidadeDeCompra(7800, 10000, 20)).toBe(true)
  })

  it('cotação exatamente no limite → oportunidade', () => {
    expect(oportunidadeDeCompra(8000, 10000, 20)).toBe(true)
  })

  it('sem dados cadastrados → sem oportunidade', () => {
    expect(oportunidadeDeCompra(7800, null, null)).toBe(false)
    expect(oportunidadeDeCompra(null, 10000, 20)).toBe(false)
    expect(oportunidadeDeCompra(7800, 10000, null)).toBe(false)
  })

  it('cotação inválida (zero) não dispara falso positivo', () => {
    expect(oportunidadeDeCompra(0, 10000, 20)).toBe(false)
  })
})

describe('tickersComOportunidade', () => {
  it('cruza valuation e consolidado ignorando caixa/espaços do ticker', () => {
    const oportunidades = tickersComOportunidade(
      [valuation({ ticker: ' petr4 ', precoTeto: 10000, margemSeguranca: 20 })],
      [consolidado({ ticker: 'PETR4', precoAtual: 7800 })],
    )
    expect(oportunidades.has('PETR4')).toBe(true)
  })

  it('não marca ticker sem valuation', () => {
    const oportunidades = tickersComOportunidade(
      [],
      [consolidado({ ticker: 'PETR4', precoAtual: 7800 })],
    )
    expect(oportunidades.size).toBe(0)
  })
})
