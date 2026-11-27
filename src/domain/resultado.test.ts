import { describe, expect, it } from 'vitest'
import { calcularConsolidado } from '@/domain/consolidado'
import { calcularResultado, resultadosDeEncerrados } from '@/domain/resultado'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'

/**
 * Testes do resultado da carteira em **retorno total**.
 *
 * Convenção: dinheiro em **centavos**. Ex.: `R$ 10,00` → `1000`.
 */

type NovaOperacao = Pick<Operacao, 'ticker' | 'quantidade' | 'precoUnitario' | 'tipo'> &
  Partial<Operacao>

function operacao(partial: NovaOperacao): Operacao {
  return {
    id: `op-${partial.ticker}-${partial.data ?? ''}-${Math.random().toString(36).slice(2)}`,
    data: '2026-01-02',
    categoria: CategoriaAtivo.Acao,
    taxas: 0,
    indexador: null,
    percentualIndexador: null,
    vencimento: null,
    valorBrutoAtual: null,
    ...partial,
  }
}

function provento(partial: Partial<Provento> & { valorTotal: number }): Provento {
  return {
    id: `prov-${partial.ticker ?? 'PETR4'}-${partial.dataPagamento ?? '2026-01-20'}`,
    dataCom: null,
    dataPagamento: '2026-01-20',
    categoria: CategoriaAtivo.Acao,
    ticker: 'PETR4',
    tipo: ProventoTipo.Dividendo,
    ...partial,
  }
}

describe('calcularResultado', () => {
  it('soma variação de preço, lucro realizado líquido de taxas e proventos', () => {
    const operacoes = [
      // Posição aberta com valorização.
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 1000,
      }),
      // Ciclo encerrado com resultado realizado.
      operacao({
        ticker: 'MXRF11',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 500,
        categoria: CategoriaAtivo.Fii,
      }),
      operacao({
        ticker: 'MXRF11',
        tipo: OperacaoTipo.Venda,
        quantidade: 100,
        precoUnitario: 600,
        taxas: 10,
        data: '2026-02-02',
        categoria: CategoriaAtivo.Fii,
      }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1200]]))
    const proventos = [provento({ valorTotal: 3000 })]

    const resultado = calcularResultado(consolidado, operacoes, proventos)

    expect(resultado.variacaoPreco).toBe(20000)
    expect(resultado.lucroRealizado).toBe(9990)
    expect(resultado.proventos).toBe(3000)
    expect(resultado.capitalAportado).toBe(150000)
    expect(resultado.retornoTotal).toBe(32990)
    // 32.990 ÷ 150.000 × 100 = 21,9933…
    expect(resultado.rentabilidadeTotalPercent).toBe(21.99)
    expect(resultado.patrimonioTotal).toBe(120000)
  })

  it('ignora proventos posteriores à data limite', () => {
    const operacoes = [
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 1000,
      }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1000]]))
    const proventos = [
      provento({ dataPagamento: '2026-01-15', valorTotal: 1000 }),
      provento({ dataPagamento: '2026-03-15', valorTotal: 2000 }),
    ]

    const resultado = calcularResultado(consolidado, operacoes, proventos, '2026-01-31')
    expect(resultado.proventos).toBe(1000)
    expect(resultado.retornoTotal).toBe(1000)
  })

  it('ignora proventos de ciclos encerrados antes da data-com', () => {
    const operacoes = [
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 1000,
      }),
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Venda,
        quantidade: 100,
        precoUnitario: 1000,
        data: '2026-02-02',
      }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1000]]))
    const proventos = [
      // data-com depois da venda → não pertence ao investidor
      provento({ dataCom: '2026-03-01', dataPagamento: '2026-03-15', valorTotal: 500 }),
      // data-com durante a posse → pertence, mesmo com pagamento após a venda
      provento({ dataCom: '2026-01-20', dataPagamento: '2026-03-15', valorTotal: 300 }),
    ]

    const resultado = calcularResultado(consolidado, operacoes, proventos)
    expect(resultado.proventos).toBe(300)
    expect(resultado.retornoTotal).toBe(300)
  })

  it('nunca divide por zero sem capital aportado', () => {
    const resultado = calcularResultado([], [], [])
    expect(resultado).toEqual({
      patrimonioTotal: 0,
      totalInvestido: 0,
      variacaoPreco: 0,
      rentabilidadePrecoPercent: 0,
      lucroRealizado: 0,
      proventos: 0,
      capitalAportado: 0,
      retornoTotal: 0,
      rentabilidadeTotalPercent: 0,
    })
  })
})

describe('resultadosDeEncerrados', () => {
  it('apura capital, realizado líquido de taxas, proventos e percentual', () => {
    const operacoes = [
      operacao({
        ticker: 'MXRF11',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 1000,
        taxas: 100,
        categoria: CategoriaAtivo.Fii,
      }),
      operacao({
        ticker: 'MXRF11',
        tipo: OperacaoTipo.Venda,
        quantidade: 100,
        precoUnitario: 1200,
        taxas: 50,
        data: '2026-02-02',
        categoria: CategoriaAtivo.Fii,
      }),
      // Posição aberta: não entra no mapa de encerrados.
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1100]]))
    const proventos = [
      provento({
        ticker: 'MXRF11',
        tipo: ProventoTipo.Rendimento,
        categoria: CategoriaAtivo.Fii,
        dataCom: '2026-01-20',
        dataPagamento: '2026-02-20',
        valorTotal: 300,
      }),
    ]

    const mapa = resultadosDeEncerrados(consolidado, operacoes, proventos)
    const encerrado = mapa.get('MXRF11')

    expect(mapa.has('PETR4')).toBe(false)
    expect(encerrado?.capitalAportado).toBe(100100)
    // 100 × 1200 − 100 × 1001 − 50 de taxas = 19.850
    expect(encerrado?.lucroRealizado).toBe(19850)
    expect(encerrado?.proventos).toBe(300)
    expect(encerrado?.resultado).toBe(20150)
    expect(encerrado?.resultadoPercent).toBe(20.13)
  })

  it('devolve mapa vazio sem posições encerradas', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1100]]))
    expect(resultadosDeEncerrados(consolidado, operacoes, [])).toEqual(new Map())
  })
})
