import { describe, expect, it } from 'vitest'
import { calcularConsolidado } from '@/lib/consolidado'
import {
  calcularDetalheAtivo,
  calcularFluxoRealizado,
  serieDecomposicaoRetorno,
  serieProventosPorMes,
} from '@/lib/detalheAtivo'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/types/domain'
import type { Consolidado, Operacao, Provento } from '@/types/domain'

/**
 * Testes do detalhe do ativo (RF10 — modal do Dashboard).
 *
 * Convenção: dinheiro em **centavos**. Ex.: `R$ 10,00` → `1000`.
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

type NovoProvento = Pick<Provento, 'ticker' | 'dataPagamento' | 'valorTotal'> & Partial<Provento>

function provento(partial: NovoProvento): Provento {
  return {
    id: `prov-${partial.ticker}-${partial.dataPagamento}-${Math.random().toString(36).slice(2)}`,
    dataCom: null,
    categoria: CategoriaAtivo.Acao,
    tipo: ProventoTipo.Dividendo,
    ...partial,
  }
}

function linhaConsolidado(partial: Pick<Consolidado, 'ticker'> & Partial<Consolidado>): Consolidado {
  return {
    categoria: CategoriaAtivo.Acao,
    quantidadeAtual: 0,
    precoMedio: 0,
    precoAtual: 0,
    totalInvestido: 0,
    valorAtual: 0,
    lucroPrejuizo: 0,
    lucroPrejuizoPercent: 0,
    percentualCarteira: 0,
    ...partial,
  }
}

function obterDetalhe(
  ticker: string,
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  consolidado: readonly Consolidado[],
  dataReferencia?: string,
) {
  const detalhe = calcularDetalheAtivo(ticker, operacoes, proventos, consolidado, dataReferencia)
  if (detalhe === null) throw new Error('Esperava um detalhe não nulo.')
  return detalhe
}

const comprasBase = [
  operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-01-10' }),
  operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 50, precoUnitario: 800, data: '2026-02-20' }),
  operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 50, precoUnitario: 1200, data: '2026-03-05' }),
]

describe('calcularDetalheAtivo (menor/maior compra e datas)', () => {
  it('calcula menor/maior preço de compra e a 1ª/última compra', () => {
    const consolidado = calcularConsolidado(comprasBase, new Map([['PETR4', 1500]]))
    const detalhe = obterDetalhe('PETR4', comprasBase, [], consolidado)

    expect(detalhe.menorPrecoCompra).toBe(800)
    expect(detalhe.maiorPrecoCompra).toBe(1200)
    expect(detalhe.primeiraCompra).toBe('2026-01-10')
    expect(detalhe.ultimaCompra).toBe('2026-03-05')
  })

  it('ignora as vendas no menor/maior e nas datas', () => {
    const operacoes = [
      ...comprasBase,
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 50, precoUnitario: 9999, data: '2026-04-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1500]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    expect(detalhe.menorPrecoCompra).toBe(800)
    expect(detalhe.maiorPrecoCompra).toBe(1200)
    expect(detalhe.primeiraCompra).toBe('2026-01-10')
    expect(detalhe.ultimaCompra).toBe('2026-03-05')
  })

  it('ignora eventos corporativos no menor/maior e nas datas', () => {
    const operacoes = [
      ...comprasBase,
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Split, quantidade: 2, precoUnitario: 0, data: '2026-05-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1500]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    expect(detalhe.menorPrecoCompra).toBe(800)
    expect(detalhe.maiorPrecoCompra).toBe(1200)
    expect(detalhe.primeiraCompra).toBe('2026-01-10')
    expect(detalhe.ultimaCompra).toBe('2026-03-05')
  })
})

describe('calcularDetalheAtivo (proventos no período)', () => {
  it('soma proventos entre a 1ª compra e a data de referência (inclusiva) e ignora os de fora', () => {
    const consolidado = calcularConsolidado(comprasBase, new Map([['PETR4', 1500]]))
    const proventos = [
      provento({ ticker: 'PETR4', dataPagamento: '2025-12-31', valorTotal: 500 }), // antes da 1ª compra
      provento({ ticker: 'PETR4', dataPagamento: '2026-01-10', valorTotal: 300 }), // limite inferior
      provento({ ticker: 'PETR4', dataPagamento: '2026-02-15', valorTotal: 700 }),
      provento({ ticker: 'PETR4', dataPagamento: '2026-03-05', valorTotal: 200 }),
      provento({ ticker: 'PETR4', dataPagamento: '2026-06-01', valorTotal: 900 }), // após a última compra
    ]
    const detalhe = obterDetalhe('PETR4', comprasBase, proventos, consolidado, '2026-06-30')

    // inclui o provento após a última compra (2026-06-01) até a data de referência:
    // 300 + 700 + 200 + 900 = 2100
    expect(detalhe.proventosNoPeriodo).toBe(2100)
    expect(detalhe.dataReferencia).toBe('2026-06-30')
  })

  it('usa a data de referência como fim da janela (exclui pagamentos posteriores)', () => {
    const consolidado = calcularConsolidado(comprasBase, new Map([['PETR4', 1500]]))
    const proventos = [
      provento({ ticker: 'PETR4', dataPagamento: '2026-02-15', valorTotal: 700 }),
      provento({ ticker: 'PETR4', dataPagamento: '2026-06-01', valorTotal: 900 }),
    ]
    const detalhe = obterDetalhe('PETR4', comprasBase, proventos, consolidado, '2026-03-05')

    expect(detalhe.proventosNoPeriodo).toBe(700)
  })

  it('ignora proventos de outro ticker', () => {
    const consolidado = calcularConsolidado(comprasBase, new Map([['PETR4', 1500]]))
    const proventos = [
      provento({ ticker: 'PETR4', dataPagamento: '2026-02-15', valorTotal: 700 }),
      provento({ ticker: 'VALE3', dataPagamento: '2026-02-15', valorTotal: 999 }),
    ]
    const detalhe = obterDetalhe('PETR4', comprasBase, proventos, consolidado, '2026-12-31')

    expect(detalhe.proventosNoPeriodo).toBe(700)
  })

  it('sem compras: menor/maior e datas nulos e proventos zerados (usa o consolidado)', () => {
    const consolidado = [
      linhaConsolidado({
        ticker: 'PETR4',
        quantidadeAtual: 100,
        precoMedio: 1000,
        precoAtual: 1200,
        totalInvestido: 100000,
        valorAtual: 120000,
        lucroPrejuizo: 20000,
        lucroPrejuizoPercent: 20,
        percentualCarteira: 100,
      }),
    ]
    const proventos = [provento({ ticker: 'PETR4', dataPagamento: '2026-02-15', valorTotal: 700 })]
    const detalhe = obterDetalhe('PETR4', [], proventos, consolidado)

    expect(detalhe.menorPrecoCompra).toBeNull()
    expect(detalhe.maiorPrecoCompra).toBeNull()
    expect(detalhe.primeiraCompra).toBeNull()
    expect(detalhe.ultimaCompra).toBeNull()
    expect(detalhe.proventosNoPeriodo).toBe(0)
    expect(detalhe.precoAtual).toBe(1200)
    expect(detalhe.totalInvestido).toBe(100000)
    expect(detalhe.lucroRealizado).toBe(0)
    expect(detalhe.lucroFlutuante).toBe(20000)
  })

  it('retorna null para ticker inexistente e para ticker vazio', () => {
    const consolidado = calcularConsolidado(comprasBase, new Map([['PETR4', 1500]]))
    expect(calcularDetalheAtivo('XXXX', comprasBase, [], consolidado)).toBeNull()
    expect(calcularDetalheAtivo('   ', comprasBase, [], consolidado)).toBeNull()
  })

  it('normaliza o ticker com espaços (`" PETR4 "`)', () => {
    const consolidado = calcularConsolidado(comprasBase, new Map([['PETR4', 1500]]))
    const detalhe = obterDetalhe(' PETR4 ', comprasBase, [], consolidado)

    expect(detalhe.ticker).toBe('PETR4')
    expect(detalhe.categoria).toBe(CategoriaAtivo.Acao)
  })
})

describe('calcularDetalheAtivo (rentabilidade da posição)', () => {
  it('calcula ((valorAtual − totalInvestido) + proventos) / totalInvestido × 100', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-01-10' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1200]]))
    const proventos = [provento({ ticker: 'PETR4', dataPagamento: '2026-01-10', valorTotal: 5000 })]
    const detalhe = obterDetalhe('PETR4', operacoes, proventos, consolidado)

    // (120000 − 100000 + 5000) / 100000 × 100 = 25
    expect(detalhe.retornoPosicao).toBe(25000)
    expect(detalhe.rentabilidadePercent).toBe(25)
  })

  it('não divide por zero quando o total investido é 0', () => {
    const consolidado = [
      linhaConsolidado({ ticker: 'PETR4', totalInvestido: 0, valorAtual: 0, quantidadeAtual: 0 }),
    ]
    const detalhe = obterDetalhe('PETR4', [], [], consolidado)

    expect(detalhe.retornoPosicao).toBe(0)
    expect(detalhe.rentabilidadePercent).toBe(0)
    expect(detalhe.rentabilidadeTotalPercent).toBe(0)
  })
})

describe('calcularFluxoRealizado (custo médio incremental)', () => {
  it('apura o lucro realizado de um ciclo encerrado', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 2000, data: '2026-02-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes)
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    // 10 × 2000 − 10 × 1000 = 10000 (R$ 100,00)
    expect(detalhe.lucroRealizado).toBe(10000)
  })

  it('usa o capital aportado no denominador da rentabilidade total', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 1, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 1, precoUnitario: 2000, data: '2026-02-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 1, precoUnitario: 1200, data: '2026-03-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1500]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    expect(detalhe.lucroRealizado).toBe(1000) // 20 − 10
    expect(detalhe.lucroFlutuante).toBe(300) // 15 − 12
    expect(detalhe.retornoTotal).toBe(1300) // R$ 13,00
    expect(detalhe.capitalAportado).toBe(2200) // 1000 + 1200
    // 1300 ÷ 2200 × 100 = 59.09
    expect(detalhe.rentabilidadeTotalPercent).toBe(59.09)
  })

  it('não divide por zero ao vender sem posição', () => {
    const fluxo = calcularFluxoRealizado('PETR4', [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 5, precoUnitario: 2000, data: '2026-01-01' }),
    ])

    expect(fluxo.lucroRealizado).toBe(10000)
    expect(fluxo.custoPosicaoAtual).toBe(0)
  })

  it('eventos corporativos não geram lucro realizado (apenas ajustam a quantidade)', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Split, quantidade: 2, precoUnitario: 0, data: '2026-02-01' }),
    ]
    const fluxo = calcularFluxoRealizado('PETR4', operacoes)

    expect(fluxo.lucroRealizado).toBe(0)
    expect(fluxo.quantidadePosicao).toBe(20)
    expect(fluxo.custoPosicaoAtual).toBe(10000)
  })

  it('não divide por zero quando não há capital aportado', () => {
    const consolidado = [
      linhaConsolidado({ ticker: 'PETR4', quantidadeAtual: 0, totalInvestido: 0, valorAtual: 0 }),
    ]
    const detalhe = obterDetalhe('PETR4', [], [], consolidado)

    expect(detalhe.capitalAportado).toBe(0)
    expect(detalhe.rentabilidadeTotalPercent).toBe(0)
  })
})

describe('Rentabilidade Total (fluxo de caixa)', () => {
  it('sem vendas, coincide com a rentabilidade da posição (mesmo com várias compras e proventos)', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-01-10' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-02-10' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1500]]))
    const proventos = [provento({ ticker: 'PETR4', dataPagamento: '2026-02-10', valorTotal: 3000 })]
    const detalhe = obterDetalhe('PETR4', operacoes, proventos, consolidado)

    expect(detalhe.lucroRealizado).toBe(0)
    expect(detalhe.capitalAportado).toBe(detalhe.totalInvestido)
    expect(detalhe.rentabilidadePercent).toBe(51.5)
    expect(detalhe.rentabilidadeTotalPercent).toBe(detalhe.rentabilidadePercent)
  })

  it('difere da posição quando há lucro realizado (vendas)', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 50, precoUnitario: 1500, data: '2026-02-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1200]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    expect(detalhe.lucroRealizado).toBe(25000)
    expect(detalhe.rentabilidadeTotalPercent).not.toBe(detalhe.rentabilidadePercent)
  })
})

describe('calcularDetalheAtivo (posição encerrada)', () => {
  it('expõe o capital aportado como "Valor investido" quando todas as ações são vendidas', () => {
    const operacoes = [
      operacao({ ticker: 'AUV11', tipo: OperacaoTipo.Compra, quantidade: 65, precoUnitario: 10365, data: '2026-01-10' }),
      operacao({ ticker: 'AUV11', tipo: OperacaoTipo.Venda, quantidade: 65, precoUnitario: 15300, data: '2026-04-10' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['AUV11', 15300]]))
    const detalhe = obterDetalhe('AUV11', operacoes, [], consolidado)

    expect(detalhe.posicaoEncerrada).toBe(true)
    expect(detalhe.totalInvestido).toBe(0) // o Consolidado zera a posição
    expect(detalhe.valorInvestido).toBe(65 * 10365) // capital aportado nas compras
    expect(detalhe.valorAtual).toBe(0)
  })

  it('mantém o custo da posição como "Valor investido" enquanto ainda há ações', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 40, precoUnitario: 1500, data: '2026-02-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1200]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    expect(detalhe.posicaoEncerrada).toBe(false)
    expect(detalhe.valorInvestido).toBe(detalhe.totalInvestido)
  })

  it('sem operações (posição só do Consolidado) não é considerada encerrada', () => {
    const consolidado = [linhaConsolidado({ ticker: 'PETR4', quantidadeAtual: 0 })]
    const detalhe = obterDetalhe('PETR4', [], [], consolidado)

    expect(detalhe.posicaoEncerrada).toBe(false)
    expect(detalhe.valorInvestido).toBe(0)
  })

  it('waterfall parte do capital aportado e termina no "Total recebido"', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 2000, data: '2026-02-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 2000]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    const serie = serieDecomposicaoRetorno(detalhe)
    const final = serie[serie.length - 1]

    expect(serie[0].rotulo).toBe('Valor investido')
    expect(serie[0].valor).toBe(10000) // capital aportado (10 × 1000)
    expect(serie[0].valor).toBeGreaterThan(0)
    expect(final.rotulo).toBe('Total recebido')
    expect(final.valor).toBe(20000) // capital aportado (10000) + lucro realizado (10000)
  })
})

describe('séries para os gráficos', () => {
  it('serieDecomposicaoRetorno termina no patrimônio final (valor investido + lucros + proventos)', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 1, precoUnitario: 1000, data: '2026-01-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Venda, quantidade: 1, precoUnitario: 2000, data: '2026-02-01' }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 1, precoUnitario: 1200, data: '2026-03-01' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1500]]))
    const detalhe = obterDetalhe('PETR4', operacoes, [], consolidado)

    const serie = serieDecomposicaoRetorno(detalhe)
    const final = serie[serie.length - 1]

    expect(serie).toHaveLength(5)
    expect(serie[0].rotulo).toBe('Valor investido')
    expect(final.rotulo).toBe('Patrimônio final')
    // valor investido (200) + realizado (1000) + flutuante (300) + proventos (0)
    expect(final.valor).toBe(1500)
    expect(final.acumulado).toBe(1500)
  })

  it('serieProventosPorMes agrupa por mês, restrito ao ticker e à janela', () => {
    const proventos = [
      provento({ ticker: 'PETR4', dataPagamento: '2025-12-15', valorTotal: 500 }),
      provento({ ticker: 'PETR4', dataPagamento: '2026-01-20', valorTotal: 300 }),
      provento({ ticker: 'PETR4', dataPagamento: '2026-01-28', valorTotal: 200 }),
      provento({ ticker: 'PETR4', dataPagamento: '2026-03-10', valorTotal: 700 }),
      provento({ ticker: 'VALE3', dataPagamento: '2026-02-10', valorTotal: 999 }),
    ]

    const serie = serieProventosPorMes(proventos, 'PETR4', '2026-01-01', '2026-03-31')

    expect(serie.map((item) => item.chave)).toEqual(['2026-01', '2026-03'])
    expect(serie.map((item) => item.valorTotal)).toEqual([500, 700])
    expect(serie[0].rotulo).toBe('Janeiro de 2026')
  })

  it('serieProventosPorMes retorna vazio sem compras (janela nula)', () => {
    const proventos = [provento({ ticker: 'PETR4', dataPagamento: '2026-01-20', valorTotal: 300 })]
    expect(serieProventosPorMes(proventos, 'PETR4', null, null)).toEqual([])
  })
})
