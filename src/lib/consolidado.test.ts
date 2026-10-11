import { describe, expect, it } from 'vitest'
import {
  aplicarPrecosAtuais,
  calcularConsolidado,
  calcularPosicoes,
  calcularResumo,
} from '@/lib/consolidado'
import { buildConsolidadoRows, buildGoogFinanceFormula, formulaSeparatorForLocale } from '@/lib/sheetFormulas'
import { CategoriaAtivo, OperacaoTipo } from '@/types/domain'
import type { Operacao } from '@/types/domain'

/**
 * Testes das fórmulas da carteira (Seção 5.1).
 *
 * Convenção: dinheiro em centavos. Ex.: `R$ 10,00` → `1000`.
 */

type NovaOperacao = Pick<Operacao, 'ticker' | 'quantidade' | 'precoUnitario' | 'tipo'> &
  Partial<Operacao>

function operacao(partial: NovaOperacao): Operacao {
  return {
    id: `op-${partial.ticker}-${partial.data ?? ''}-${Math.random().toString(36).slice(2)}`,
    data: '2026-01-01',
    categoria: CategoriaAtivo.Acao,
    taxas: 0,
    indexador: null,
    percentualIndexador: null,
    vencimento: null,
    valorBrutoAtual: null,
    ...partial,
  }
}

describe('calcularPosicoes (fórmulas 1–3)', () => {
  it('converte uma única compra em quantidade, preço médio e total investido', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
    ])

    expect(posicoes).toHaveLength(1)
    expect(posicoes[0]).toMatchObject({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      quantidadeAtual: 100,
      precoMedio: 1000,
      totalInvestido: 100000,
    })
  })

  it('consolida compras e vendas mistas sem alterar o preço médio na venda', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({ ticker: 'PETR4', quantidade: 50, precoUnitario: 1200, tipo: OperacaoTipo.Venda }),
    ])

    expect(posicoes[0].quantidadeAtual).toBe(50)
    // A venda não altera o preço médio: custo restante = 50 × 1000 = 50000.
    expect(posicoes[0].precoMedio).toBe(1000)
    expect(posicoes[0].totalInvestido).toBe(50000)
  })

  it('inclui as taxas de compra no custo e não deixa a venda alterar o preço médio', () => {
    const posicoes = calcularPosicoes([
      operacao({
        ticker: 'PETR4',
        quantidade: 100,
        precoUnitario: 1000,
        taxas: 1000,
        tipo: OperacaoTipo.Compra,
      }),
      operacao({
        ticker: 'PETR4',
        quantidade: 50,
        precoUnitario: 1200,
        taxas: 500,
        tipo: OperacaoTipo.Venda,
      }),
    ])

    // Compra: (100×1000 + 1000) = 101000 → preço médio 1010.
    // Venda de 50 @ 1200: custo restante = 50 × 1010 = 50500.
    expect(posicoes[0].quantidadeAtual).toBe(50)
    expect(posicoes[0].precoMedio).toBe(1010)
    expect(posicoes[0].totalInvestido).toBe(50500)
  })

  it('zera preço médio e total investido quando a posição está zerada', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1500, tipo: OperacaoTipo.Venda }),
    ])

    expect(posicoes[0].quantidadeAtual).toBe(0)
    expect(posicoes[0].precoMedio).toBe(0)
    expect(posicoes[0].totalInvestido).toBe(0)
  })

  it('mantém a categoria da operação mais recente', () => {
    const posicoes = calcularPosicoes([
      operacao({
        ticker: 'TD2029',
        quantidade: 10,
        precoUnitario: 10000,
        tipo: OperacaoTipo.Compra,
        data: '2026-01-01',
        categoria: CategoriaAtivo.TesouroDireto,
      }),
      operacao({
        ticker: 'TD2029',
        quantidade: 5,
        precoUnitario: 10000,
        tipo: OperacaoTipo.Compra,
        data: '2026-02-01',
        categoria: CategoriaAtivo.RendaFixa,
      }),
    ])

    expect(posicoes[0].categoria).toBe(CategoriaAtivo.RendaFixa)
  })

  it('ignora operações sem ticker', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: '   ', quantidade: 10, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
    ])

    expect(posicoes).toHaveLength(0)
  })
})

describe('aplicarPrecosAtuais (fórmulas 4–6)', () => {
  it('calcula valor atual, lucro (R$ e %) e % da carteira de múltiplos ativos', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({ ticker: 'MXRF11', quantidade: 200, precoUnitario: 500, tipo: OperacaoTipo.Compra }),
    ]
    const precos = new Map<string, number>([
      ['PETR4', 1200],
      ['MXRF11', 400],
    ])

    const consolidado = calcularConsolidado(operacoes, precos)
    const porTicker = new Map(consolidado.map((linha) => [linha.ticker, linha]))

    expect(porTicker.get('PETR4')).toMatchObject({
      valorAtual: 120000,
      totalInvestido: 100000,
      lucroPrejuizo: 20000,
      lucroPrejuizoPercent: 20,
      percentualCarteira: 60,
    })
    expect(porTicker.get('MXRF11')).toMatchObject({
      valorAtual: 80000,
      totalInvestido: 100000,
      lucroPrejuizo: -20000,
      lucroPrejuizoPercent: -20,
      percentualCarteira: 40,
    })

    const somaPercentuais = consolidado.reduce((total, linha) => total + linha.percentualCarteira, 0)
    expect(somaPercentuais).toBeCloseTo(100, 2)
  })

  it('normaliza o % da carteira e zera a participação de posição zerada', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({ ticker: 'VALE3', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({ ticker: 'ITSA4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({ ticker: 'ITSA4', quantidade: 100, precoUnitario: 1500, tipo: OperacaoTipo.Venda }),
    ]
    const precos = new Map<string, number>([
      ['PETR4', 1000],
      ['VALE3', 1000],
    ])

    const consolidado = calcularConsolidado(operacoes, precos)
    const zerada = consolidado.find((linha) => linha.ticker === 'ITSA4')
    expect(zerada).toMatchObject({
      quantidadeAtual: 0,
      precoMedio: 0,
      totalInvestido: 0,
      valorAtual: 0,
      lucroPrejuizoPercent: 0,
      percentualCarteira: 0,
    })

    const somaPercentuais = consolidado.reduce((total, linha) => total + linha.percentualCarteira, 0)
    expect(somaPercentuais).toBeCloseTo(100, 2)
  })

  it('usa o preço médio como fallback quando a cotação não é informada', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
    ]

    const [linha] = aplicarPrecosAtuais(calcularPosicoes(operacoes))
    expect(linha.precoAtual).toBe(1000)
    expect(linha.lucroPrejuizo).toBe(0)
    expect(linha.lucroPrejuizoPercent).toBe(0)
    // Único ativo da carteira → 100% da participação.
    expect(linha.percentualCarteira).toBe(100)
  })

  it('nunca divide por zero em carteira vazia', () => {
    const consolidado = aplicarPrecosAtuais(calcularPosicoes([]))
    expect(consolidado).toHaveLength(0)
    expect(calcularResumo(consolidado)).toEqual({
      patrimonioTotal: 0,
      totalInvestido: 0,
      lucroTotal: 0,
      rentabilidadePercent: 0,
    })
  })
})

describe('calcularResumo', () => {
  it('agrega patrimônio, investido, lucro e rentabilidade', () => {
    const consolidado = calcularConsolidado(
      [
        operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
        operacao({ ticker: 'MXRF11', quantidade: 200, precoUnitario: 500, tipo: OperacaoTipo.Compra }),
      ],
      new Map<string, number>([
        ['PETR4', 1200],
        ['MXRF11', 400],
      ]),
    )

    expect(calcularResumo(consolidado)).toEqual({
      patrimonioTotal: 200000,
      totalInvestido: 200000,
      lucroTotal: 0,
      rentabilidadePercent: 0,
    })
  })
})

describe('sheetFormulas', () => {
  it('detecta o separador de fórmula pelo locale da planilha', () => {
    expect(formulaSeparatorForLocale('pt_BR')).toBe(';')
    expect(formulaSeparatorForLocale('pt-PT')).toBe(';')
    expect(formulaSeparatorForLocale('en_US')).toBe(',')
    expect(formulaSeparatorForLocale('en-GB')).toBe(',')
    expect(formulaSeparatorForLocale(null)).toBe(';')
    expect(formulaSeparatorForLocale('')).toBe(';')
  })

  it('monta a fórmula do GOOGLEFINANCE com o separador correto', () => {
    expect(buildGoogFinanceFormula('$A2', ';')).toBe('=GOOGLEFINANCE("BVMF:"&$A2;"price")')
    expect(buildGoogFinanceFormula('$A2', ',')).toBe('=GOOGLEFINANCE("BVMF:"&$A2,"price")')
  })

  it('gera as 10 colunas, usando fórmula de cotação para Ação e valor para Renda Fixa', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
      operacao({
        ticker: 'CDB2029',
        quantidade: 10,
        precoUnitario: 10000,
        tipo: OperacaoTipo.Compra,
        categoria: CategoriaAtivo.RendaFixa,
      }),
    ])

    const rows = buildConsolidadoRows({ posicoes, precosAtuais: new Map(), separator: ';' })
    expect(rows).toHaveLength(2)

    // As posições são ordenadas por ticker: `CDB2029` antes de `PETR4`.
    const porTicker = new Map(rows.map((row) => [String(row[0]), row]))
    const petr4 = porTicker.get('PETR4')
    const cdb = porTicker.get('CDB2029')
    expect(petr4).toHaveLength(10)
    expect(cdb).toHaveLength(10)

    // Ação: coluna E é a fórmula do GOOGLEFINANCE.
    expect(petr4?.[4]).toBe('=GOOGLEFINANCE("BVMF:"&$A3;"price")')
    // Renda Fixa: coluna E é um valor (sem GOOGLEFINANCE).
    expect(cdb?.[4]).toBe(100)
    // Colunas calculadas F–J são fórmulas que referenciam a própria linha.
    expect(petr4?.[5]).toBe('=$C3*$D3')
    expect(petr4?.[6]).toBe('=$C3*$E3')
    expect(petr4?.[7]).toBe('=$G3-$F3')
    expect(String(petr4?.[8])).toContain('$H3/$F3*100')
    expect(String(petr4?.[9])).toContain('SUM($G$2:$G$3)')
  })

  it('grava valor estático (não fórmula) quando há cotação persistida para Ação (fallback Brapi)', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'PETR4', quantidade: 100, precoUnitario: 1000, tipo: OperacaoTipo.Compra }),
    ])

    const rows = buildConsolidadoRows({
      posicoes,
      precosAtuais: new Map([['PETR4', 2500]]),
      separator: ';',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.[4]).toBe(25)
  })
})
