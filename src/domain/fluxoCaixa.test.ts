import { describe, expect, it } from 'vitest'
import { calcularFluxoResultado } from '@/domain/fluxoCaixa'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'

/**
 * Testes do fluxo de caixa (base do retorno total e da série de evolução).
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

function provento(
  partial: Partial<Provento> & { dataPagamento: string; valorTotal: number },
): Provento {
  return {
    id: `prov-${partial.ticker ?? 'PETR4'}-${partial.dataPagamento}`,
    dataCom: null,
    categoria: CategoriaAtivo.Acao,
    ticker: 'PETR4',
    tipo: ProventoTipo.Dividendo,
    ...partial,
  }
}

describe('calcularFluxoResultado', () => {
  it('apura o lucro da venda líquido das taxas de venda', () => {
    const operacoes = [
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 1000,
        taxas: 50,
        data: '2026-01-02',
      }),
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Venda,
        quantidade: 40,
        precoUnitario: 1500,
        taxas: 20,
        data: '2026-02-02',
      }),
    ]

    const fluxo = calcularFluxoResultado(operacoes)

    expect(fluxo.capitalAportado).toBe(100050)
    expect(fluxo.vendasLiquidas).toBe(59980)
    // 40 × 1500 − 40 × 1000,50 − 20 de taxas.
    expect(fluxo.lucroRealizado).toBe(19960)
    expect(fluxo.quantidadePosicao).toBe(60)
    expect(fluxo.custoPosicaoAtual).toBe(60030)
  })

  it('soma proventos e respeita o filtro de data limite (inclusive)', () => {
    const proventos = [
      provento({ dataPagamento: '2026-01-15', valorTotal: 1000 }),
      provento({ dataPagamento: '2026-03-15', valorTotal: 2500 }),
    ]

    expect(calcularFluxoResultado([], proventos).proventos).toBe(3500)
    expect(calcularFluxoResultado([], proventos, { ate: '2026-01-15' }).proventos).toBe(1000)
    expect(calcularFluxoResultado([], proventos, { ate: '2026-02-28' }).proventos).toBe(1000)
  })

  it('reconstrói o passado com o filtro `ate`', () => {
    const operacoes = [
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Compra,
        quantidade: 10,
        precoUnitario: 1000,
        data: '2026-01-10',
      }),
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Venda,
        quantidade: 10,
        precoUnitario: 1500,
        data: '2026-02-10',
      }),
    ]

    const antesDaVenda = calcularFluxoResultado(operacoes, [], { ate: '2026-01-31' })
    expect(antesDaVenda.quantidadePosicao).toBe(10)
    expect(antesDaVenda.lucroRealizado).toBe(0)
    expect(antesDaVenda.custoPosicaoAtual).toBe(10000)

    const depoisDaVenda = calcularFluxoResultado(operacoes, [], { ate: '2026-02-28' })
    expect(depoisDaVenda.quantidadePosicao).toBe(0)
    expect(depoisDaVenda.lucroRealizado).toBe(5000)
    expect(depoisDaVenda.custoPosicaoAtual).toBe(0)
    // O capital aportado é histórico e não diminui com a venda.
    expect(depoisDaVenda.capitalAportado).toBe(10000)
  })

  it('isola um ticker e ignora operações/proventos dos demais', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      operacao({
        ticker: 'MXRF11',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 100,
        categoria: CategoriaAtivo.Fii,
      }),
    ]
    const proventos = [
      provento({ ticker: 'PETR4', dataPagamento: '2026-01-20', valorTotal: 300 }),
      provento({
        ticker: 'MXRF11',
        dataPagamento: '2026-01-20',
        valorTotal: 700,
        categoria: CategoriaAtivo.Fii,
        tipo: ProventoTipo.Rendimento,
      }),
    ]

    const fluxo = calcularFluxoResultado(operacoes, proventos, { ticker: 'PETR4' })
    expect(fluxo.capitalAportado).toBe(10000)
    expect(fluxo.proventos).toBe(300)
  })

  it('não altera o custo em eventos corporativos (split e bonificação)', () => {
    const operacoes = [
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 1000,
      }),
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Split,
        quantidade: 2,
        precoUnitario: 0,
        data: '2026-02-01',
      }),
      operacao({
        ticker: 'PETR4',
        tipo: OperacaoTipo.Bonificacao,
        quantidade: 10,
        precoUnitario: 0,
        data: '2026-03-01',
      }),
    ]

    const fluxo = calcularFluxoResultado(operacoes)
    expect(fluxo.quantidadePosicao).toBe(220)
    expect(fluxo.custoPosicaoAtual).toBe(100000)
  })

  it('devolve zeros para carteira vazia', () => {
    expect(calcularFluxoResultado([], [])).toEqual({
      capitalAportado: 0,
      vendasLiquidas: 0,
      proventos: 0,
      lucroRealizado: 0,
      custoPosicaoAtual: 0,
      quantidadePosicao: 0,
    })
  })
})
