import { describe, expect, it } from 'vitest'
import {
  CategoriaAtivo,
  OperacaoTipo,
  ProventoTipo,
} from '@/types/domain'
import type { MetaRebalanceamento, Operacao, Provento } from '@/types/domain'
import {
  atualizarCategoriaDeMetas,
  atualizarCategoriaDeOperacoes,
  atualizarCategoriaDeProventos,
  ehDoTicker,
} from '@/domain/trocaCategoria'

/**
 * Testes da troca de categoria dos registros de um ticker (RF10) nas abas
 * `Operacoes`, `Proventos` e `Metas_Rebalanceamento`. Dinheiro em centavos;
 * datas em ISO.
 */

function operacao(partial: Partial<Operacao> & { ticker: string }): Operacao {
  return {
    id: partial.id ?? `o-${partial.ticker}-${partial.data ?? '2024-01-01'}`,
    data: partial.data ?? '2024-01-01',
    tipo: partial.tipo ?? OperacaoTipo.Compra,
    categoria: partial.categoria ?? CategoriaAtivo.Acao,
    ticker: partial.ticker,
    quantidade: partial.quantidade ?? 100,
    precoUnitario: partial.precoUnitario ?? 1000,
    taxas: partial.taxas ?? 0,
    indexador: partial.indexador ?? null,
    percentualIndexador: partial.percentualIndexador ?? null,
    vencimento: partial.vencimento ?? null,
    valorBrutoAtual: partial.valorBrutoAtual ?? null,
  }
}

function provento(partial: Partial<Provento> & { ticker: string }): Provento {
  return {
    id: partial.id ?? `p-${partial.ticker}-${partial.dataPagamento ?? '2024-01-15'}`,
    dataCom: partial.dataCom ?? null,
    dataPagamento: partial.dataPagamento ?? '2024-01-15',
    categoria: partial.categoria ?? CategoriaAtivo.Acao,
    ticker: partial.ticker,
    tipo: partial.tipo ?? ProventoTipo.Dividendo,
    valorTotal: partial.valorTotal ?? 100,
  }
}

function meta(partial: Partial<MetaRebalanceamento> & { ticker: string }): MetaRebalanceamento {
  return {
    ticker: partial.ticker,
    categoria: partial.categoria ?? CategoriaAtivo.Acao,
    nota: partial.nota ?? 0,
    metaPercent: partial.metaPercent ?? 0,
    valorAtual: partial.valorAtual ?? 0,
    percentualAtual: partial.percentualAtual ?? 0,
    desvioPercent: partial.desvioPercent ?? 0,
    aporteSugerido: partial.aporteSugerido ?? 0,
    quantidadeSugerida: partial.quantidadeSugerida ?? 0,
    precoTeto: partial.precoTeto ?? null,
  }
}

describe('ehDoTicker', () => {
  it('compara ignorando caixa e espaços', () => {
    expect(ehDoTicker(operacao({ ticker: 'petr4' }), ' PETR4 ')).toBe(true)
    expect(ehDoTicker(operacao({ ticker: 'PETR4' }), 'vale3')).toBe(false)
    expect(ehDoTicker(provento({ ticker: 'PETR4' }), 'petr4')).toBe(true)
    expect(ehDoTicker(meta({ ticker: 'PETR4' }), '   ')).toBe(false)
  })
})

describe('atualizarCategoriaDeOperacoes', () => {
  it('troca a categoria de todas as operações do ticker', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', categoria: CategoriaAtivo.Acao, data: '2024-01-01' }),
      operacao({ ticker: 'VALE3', categoria: CategoriaAtivo.Acao, data: '2024-02-01' }),
      operacao({
        ticker: 'petr4',
        categoria: CategoriaAtivo.Acao,
        data: '2024-03-01',
        tipo: OperacaoTipo.Venda,
      }),
    ]

    const { operacoes: proximas, atualizadas } = atualizarCategoriaDeOperacoes(
      operacoes,
      'PETR4',
      CategoriaAtivo.Etf,
    )

    expect(atualizadas).toBe(2)
    expect(proximas.map((item) => item.categoria)).toEqual([
      CategoriaAtivo.Etf,
      CategoriaAtivo.Acao,
      CategoriaAtivo.Etf,
    ])
    expect(proximas.map((item) => item.data)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01'])
  })

  it('não conta nem altera operações que já estão na categoria de destino', () => {
    const operacoes = [
      operacao({ ticker: 'BOVA11', categoria: CategoriaAtivo.Etf }),
      operacao({ ticker: 'BOVA11', categoria: CategoriaAtivo.Fii }),
    ]

    const { operacoes: proximas, atualizadas } = atualizarCategoriaDeOperacoes(
      operacoes,
      'BOVA11',
      CategoriaAtivo.Etf,
    )

    expect(atualizadas).toBe(1)
    expect(proximas[0]).toBe(operacoes[0])
    expect(proximas[1].categoria).toBe(CategoriaAtivo.Etf)
  })

  it('retorna zero quando o ticker é vazio ou não há correspondência', () => {
    const operacoes = [operacao({ ticker: 'PETR4' })]
    expect(atualizarCategoriaDeOperacoes(operacoes, '', CategoriaAtivo.Etf).atualizadas).toBe(0)
    expect(atualizarCategoriaDeOperacoes(operacoes, 'XXXX', CategoriaAtivo.Etf).atualizadas).toBe(0)
  })
})

describe('atualizarCategoriaDeProventos', () => {
  it('troca a categoria dos proventos do ticker e ignora os demais', () => {
    const proventos = [
      provento({ ticker: 'B1AM34', categoria: CategoriaAtivo.Bdr }),
      provento({ ticker: 'B1AM34', categoria: CategoriaAtivo.Bdr, tipo: ProventoTipo.Jcp }),
      provento({ ticker: 'MXRF11', categoria: CategoriaAtivo.Fii }),
    ]

    const { proventos: proximos, atualizadas } = atualizarCategoriaDeProventos(
      proventos,
      'b1am34',
      CategoriaAtivo.Etf,
    )

    expect(atualizadas).toBe(2)
    expect(proximos.map((item) => item.categoria)).toEqual([
      CategoriaAtivo.Etf,
      CategoriaAtivo.Etf,
      CategoriaAtivo.Fii,
    ])
    expect(proximos.map((item) => item.tipo)).toEqual([
      ProventoTipo.Dividendo,
      ProventoTipo.Jcp,
      ProventoTipo.Dividendo,
    ])
  })
})

describe('atualizarCategoriaDeMetas', () => {
  it('troca a categoria das linhas do ticker sem tocar nas linhas de classe', () => {
    const metas = [
      meta({ ticker: '#Classe', categoria: CategoriaAtivo.Acao, metaPercent: 60 }),
      meta({ ticker: 'PETR4', categoria: CategoriaAtivo.Acao, nota: 8, precoTeto: 3500 }),
      meta({ ticker: 'VALE3', categoria: CategoriaAtivo.Acao, nota: 5 }),
    ]

    const { metas: proximas, atualizadas } = atualizarCategoriaDeMetas(
      metas,
      'PETR4',
      CategoriaAtivo.Etf,
    )

    expect(atualizadas).toBe(1)
    expect(proximas[0].categoria).toBe(CategoriaAtivo.Acao)
    expect(proximas[0].ticker).toBe('#Classe')
    expect(proximas[1].categoria).toBe(CategoriaAtivo.Etf)
    // Preserva os demais campos da meta.
    expect(proximas[1].nota).toBe(8)
    expect(proximas[1].precoTeto).toBe(3500)
    expect(proximas[2].categoria).toBe(CategoriaAtivo.Acao)
  })
})
