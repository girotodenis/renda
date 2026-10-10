import { describe, expect, it } from 'vitest'
import { aporteInteligente } from '@/lib/rebalanceamento/aporte'
import type { Carteira } from '@/lib/rebalanceamento/types'
import { CategoriaAtivo } from '@/types/domain'
import type { Consolidado } from '@/types/domain'

/**
 * Testes do aporte inteligente (Seção 5.3) e do preço teto (Seção 5.5).
 * Dinheiro em centavos.
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

describe('aporteInteligente (Seção 5.3)', () => {
  it('aloca todo o aporte quando a necessidade cobre o valor', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'PETR4', quantidadeAtual: 600, precoAtual: 100, valorAtual: 60000 }),
      ativo({ ticker: 'VALE3', quantidadeAtual: 400, precoAtual: 100, valorAtual: 40000 }),
    ]

    const resultado = aporteInteligente(carteira, { PETR4: 50, VALE3: 50 }, 10000)

    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toMatchObject({ ticker: 'VALE3', qtd: 100, valorAlocado: 10000 })
    expect(resultado.resto).toBe(0)
  })

  it('reporta o resto quando o preço não divide o aporte sugerido', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'PETR4', quantidadeAtual: 100, precoAtual: 300, valorAtual: 30000 }),
    ]

    const resultado = aporteInteligente(carteira, { PETR4: 100 }, 1000)

    expect(resultado[0]).toMatchObject({ ticker: 'PETR4', qtd: 3, valorAlocado: 900 })
    expect(resultado.resto).toBe(100)
  })

  it('respeita o lote padrão de 100 quando configurado', () => {
    const carteira: Carteira = [ativo({ ticker: 'PETR4', precoAtual: 10 })]

    const resultado = aporteInteligente(carteira, { PETR4: 100 }, 5010, {}, { lote: 100 })

    expect(resultado[0]).toMatchObject({ ticker: 'PETR4', qtd: 500, valorAlocado: 5000 })
    expect(resultado.resto).toBe(10)
  })

  it('permite quantidade fracionária quando habilitado', () => {
    const carteira: Carteira = [ativo({ ticker: 'TD2029', precoAtual: 1000 })]

    const resultado = aporteInteligente(carteira, { TD2029: 100 }, 1500, {}, {
      permitirFracionario: true,
    })

    expect(resultado[0].qtd).toBeCloseTo(1.5, 4)
    expect(resultado[0].valorAlocado).toBe(1500)
    expect(resultado.resto).toBe(0)
  })

  it('distribui o aporte proporcionalmente entre ativos subalocados', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'PETR4', precoAtual: 100, valorAtual: 0 }),
      ativo({ ticker: 'VALE3', precoAtual: 100, valorAtual: 0 }),
    ]

    // Metas 25/75 → necessidades 2500/7500 → alocação proporcional.
    const resultado = aporteInteligente(carteira, { PETR4: 25, VALE3: 75 }, 10000)

    expect(resultado).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: 'PETR4', qtd: 25, valorAlocado: 2500 }),
        expect.objectContaining({ ticker: 'VALE3', qtd: 75, valorAlocado: 7500 }),
      ]),
    )
    expect(resultado.resto).toBe(0)
  })

  it('não aloca nada (reporta o aporte inteiro como resto) quando não há ativos', () => {
    const resultado = aporteInteligente([], { PETR4: 100 }, 5000)

    expect(resultado).toHaveLength(0)
    expect(resultado.resto).toBe(5000)
  })
})

describe('aporteInteligente — preço teto (Seção 5.5)', () => {
  it('exclui o ativo acima do preço teto e redireciona aos elegíveis', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'CARO3', precoAtual: 200, valorAtual: 0 }),
      ativo({ ticker: 'BOM3', precoAtual: 100, valorAtual: 0 }),
    ]

    // CARO3 (preço 200) acima do teto 100 → excluído; BOM3 recebe o aporte.
    const resultado = aporteInteligente(
      carteira,
      { CARO3: 50, BOM3: 50 },
      10000,
      { CARO3: 100 },
    )

    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toMatchObject({ ticker: 'BOM3', qtd: 50, valorAlocado: 5000 })
    // O valor que iria para CARO3 (5000) permanece não alocado.
    expect(resultado.resto).toBe(5000)
  })

  it('reporta o aporte inteiro como não alocado quando todos estão acima do teto', () => {
    const carteira: Carteira = [
      ativo({ ticker: 'A', precoAtual: 100, valorAtual: 0 }),
      ativo({ ticker: 'B', precoAtual: 100, valorAtual: 0 }),
    ]

    const resultado = aporteInteligente(carteira, { A: 50, B: 50 }, 8000, { A: 10, B: 10 })

    expect(resultado).toHaveLength(0)
    expect(resultado.resto).toBe(8000)
  })
})
