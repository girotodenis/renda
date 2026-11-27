import { describe, expect, it } from 'vitest'
import { atribuirProventos, proventosAtribuidos } from '@/domain/proventos'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'

/**
 * Testes da atribuição de proventos por **data-com**.
 *
 * Convenção: dinheiro em **centavos**. Ex.: `R$ 10,00` → `1000`.
 */

type NovaOperacao = Pick<Operacao, 'ticker' | 'quantidade' | 'precoUnitario' | 'tipo' | 'data'> &
  Partial<Operacao>

function operacao(partial: NovaOperacao): Operacao {
  return {
    id: `op-${partial.ticker}-${partial.data}-${Math.random().toString(36).slice(2)}`,
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
    id: `prov-${partial.ticker ?? 'PETR4'}-${partial.dataPagamento}-${Math.random().toString(36).slice(2)}`,
    dataCom: null,
    categoria: CategoriaAtivo.Acao,
    ticker: 'PETR4',
    tipo: ProventoTipo.Dividendo,
    ...partial,
  }
}

const compra = operacao({
  ticker: 'PETR4',
  tipo: OperacaoTipo.Compra,
  quantidade: 100,
  precoUnitario: 1000,
  data: '2026-01-10',
})

const vendaTudo = operacao({
  ticker: 'PETR4',
  tipo: OperacaoTipo.Venda,
  quantidade: 100,
  precoUnitario: 1200,
  data: '2026-02-10',
})

describe('atribuirProventos', () => {
  it('atribui quando a posição existia na data-com', () => {
    const [item] = atribuirProventos(
      [compra],
      [provento({ dataCom: '2026-01-20', dataPagamento: '2026-02-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(true)
    expect(item.quantidadeNaData).toBe(100)
    expect(item.dataReferencia).toBe('2026-01-20')
    expect(item.usandoDataPagamento).toBe(false)
  })

  it('não atribui quando a posição já havia sido zerada na data-com', () => {
    const [item] = atribuirProventos(
      [compra, vendaTudo],
      [provento({ dataCom: '2026-03-01', dataPagamento: '2026-03-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(false)
    expect(item.quantidadeNaData).toBe(0)
  })

  it('atribui o provento de quem vendeu depois da data-com (pagamento após a venda)', () => {
    const [item] = atribuirProventos(
      [compra, vendaTudo],
      [provento({ dataCom: '2026-01-20', dataPagamento: '2026-03-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(true)
    expect(item.quantidadeNaData).toBe(100)
  })

  it('conta a compra feita no próprio dia da data-com', () => {
    const [item] = atribuirProventos(
      [compra],
      [provento({ dataCom: '2026-01-10', dataPagamento: '2026-02-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(true)
    expect(item.quantidadeNaData).toBe(100)
  })

  it('sem data-com, mantém o provento (não há corte confiável)', () => {
    const [item] = atribuirProventos(
      [compra, vendaTudo],
      [provento({ dataPagamento: '2026-03-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(true)
    expect(item.usandoDataPagamento).toBe(true)
    expect(item.dataReferencia).toBe('2026-03-15')
  })

  it('mantém proventos de ticker sem operações registradas (histórico incompleto)', () => {
    const [item] = atribuirProventos(
      [],
      [provento({ dataCom: '2020-05-20', dataPagamento: '2020-06-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(true)
    expect(item.quantidadeNaData).toBe(0)
  })

  it('aplica eventos corporativos na quantidade da data-com', () => {
    const split = operacao({
      ticker: 'PETR4',
      tipo: OperacaoTipo.Split,
      quantidade: 2,
      precoUnitario: 0,
      data: '2026-01-15',
    })
    const [item] = atribuirProventos(
      [compra, split],
      [provento({ dataCom: '2026-01-20', dataPagamento: '2026-02-15', valorTotal: 500 })],
    )

    expect(item.quantidadeNaData).toBe(200)
    expect(item.atribuido).toBe(true)
  })

  it('descarta proventos sem ticker', () => {
    const [item] = atribuirProventos(
      [compra],
      [provento({ ticker: '  ', dataPagamento: '2026-02-15', valorTotal: 500 })],
    )

    expect(item.atribuido).toBe(false)
  })
})

describe('proventosAtribuidos', () => {
  it('devolve apenas os proventos que pertencem ao investidor', () => {
    const proventos = [
      provento({ dataCom: '2026-01-20', dataPagamento: '2026-02-15', valorTotal: 500 }),
      provento({ dataCom: '2026-03-01', dataPagamento: '2026-03-15', valorTotal: 700 }),
    ]

    const atribuidos = proventosAtribuidos([compra, vendaTudo], proventos)

    expect(atribuidos).toHaveLength(1)
    expect(atribuidos[0].valorTotal).toBe(500)
  })
})
