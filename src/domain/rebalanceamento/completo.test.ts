import { describe, expect, it } from 'vitest'
import { rebalanceamentoCompleto, AVISO_IR_VENDAS } from '@/lib/rebalanceamento/completo'
import { calcularDesvios, TOLERANCIA_DESVIO_PERCENT } from '@/lib/rebalanceamento/desvios'
import type { Carteira } from '@/lib/rebalanceamento/types'
import { CategoriaAtivo } from '@/types/domain'
import type { Consolidado } from '@/types/domain'

/**
 * Testes do rebalanceamento completo (Seção 5.4) e dos alertas de desvio (RF16).
 */

function ativo(partial: Partial<Consolidado> & { ticker: string }): Consolidado {
  return {
    ticker: partial.ticker,
    categoria: partial.categoria ?? CategoriaAtivo.Acao,
    quantidadeAtual: partial.quantidadeAtual ?? 0,
    precoMedio: partial.precoMedio ?? 0,
    precoAtual: partial.precoAtual ?? 0,
    totalInvestido: partial.totalInvestido ?? 0,
    valorAtual: partial.valorAtual ?? 0,
    lucroPrejuizo: 0,
    lucroPrejuizoPercent: 0,
    percentualCarteira: 0,
  }
}

describe('rebalanceamentoCompleto (Seção 5.4)', () => {
  it('sugere venda do sobrealocado e compra do subalocado', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'PETR4', quantidadeAtual: 600, precoAtual: 100, valorAtual: 60000 }),
      ativo({ ticker: 'VALE3', quantidadeAtual: 400, precoAtual: 100, valorAtual: 40000 }),
    ]

    const resultado = rebalanceamentoCompleto(carteira, { PETR4: 50, VALE3: 50 })

    expect(resultado.vendas).toEqual([{ ticker: 'PETR4', qtd: 100, valorAlocado: 10000 }])
    expect(resultado.compras).toEqual([{ ticker: 'VALE3', qtd: 100, valorAlocado: 10000 }])
  })

  it('não sugere operações quando a carteira já está na meta', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'PETR4', precoAtual: 100, valorAtual: 50000 }),
      ativo({ ticker: 'VALE3', precoAtual: 100, valorAtual: 50000 }),
    ]

    const resultado = rebalanceamentoCompleto(carteira, { PETR4: 50, VALE3: 50 })

    expect(resultado.compras).toHaveLength(0)
    expect(resultado.vendas).toHaveLength(0)
  })

  it('mantém o ativo sem meta explícita inalterado (sem venda integral)', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'PETR4', precoAtual: 100, valorAtual: 100000 }),
      ativo({ ticker: 'NAOCONFIG', precoAtual: 100, valorAtual: 100000 }),
    ]

    const resultado = rebalanceamentoCompleto(carteira, { PETR4: 100 })

    expect(resultado.vendas.map((item) => item.ticker)).not.toContain('NAOCONFIG')
  })

  it('expõe o aviso de IR para vendas', () => {
    expect(AVISO_IR_VENDAS).toMatch(/IR|imposto/i)
  })
})

describe('calcularDesvios (RF16)', () => {
  it('classifica ativos subalocados, sobrealocados e equilibrados', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'SOBRE', categoria: CategoriaAtivo.Acao, precoAtual: 100, valorAtual: 70000 }),
      ativo({ ticker: 'SUB', categoria: CategoriaAtivo.Fii, precoAtual: 100, valorAtual: 20000 }),
      ativo({ ticker: 'OK', categoria: CategoriaAtivo.Bdr, precoAtual: 100, valorAtual: 10000 }),
    ]

    // Patrimônio 100000; metas: SOBRE 50, SUB 40, OK 10.
    const desvios = calcularDesvios(carteira, { SOBRE: 50, SUB: 40, OK: 10 })
    const porTicker = new Map(desvios.map((item) => [item.ticker, item]))

    expect(porTicker.get('SOBRE')).toMatchObject({
      situacao: 'sobrealocado',
      desvioPercent: 20,
      desvioValor: 20000,
    })
    expect(porTicker.get('SUB')).toMatchObject({
      situacao: 'subalocado',
      desvioPercent: -20,
      desvioValor: -20000,
    })
    expect(porTicker.get('OK')).toMatchObject({ situacao: 'equilibrado' })
    // Ordenado do mais subalocado ao mais sobrealocado.
    expect(desvios.map((item) => item.ticker)).toEqual(['SUB', 'OK', 'SOBRE'])
  })

  it('marca o ativo acima do preço teto', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'CARO3', precoAtual: 200, valorAtual: 100000 }),
    ]

    const [desvio] = calcularDesvios(carteira, { CARO3: 100 }, { precoTeto: { CARO3: 150 } })

    expect(desvio.acimaDoTeto).toBe(true)
    expect(desvio.precoTeto).toBe(150)
  })

  it('usa a tolerância padrão para considerar equilibrado', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'A', precoAtual: 100, valorAtual: 51000 }),
      ativo({ ticker: 'B', precoAtual: 100, valorAtual: 49000 }),
    ]

    const desvios = calcularDesvios(carteira, { A: 50, B: 50 })

    expect(desvios.every((item) => item.situacao === 'equilibrado')).toBe(true)
    expect(TOLERANCIA_DESVIO_PERCENT).toBeGreaterThan(0)
  })
})
