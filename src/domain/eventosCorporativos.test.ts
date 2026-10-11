import { describe, expect, it } from 'vitest'
import { calcularPosicoes } from '@/domain/consolidado'
import {
  EVENTO_CORPORATIVO_TIPOS,
  aplicarEvento,
  aplicarEventos,
  descreverEvento,
  eventoDeOperacao,
  eventoParaOperacao,
  eventosDeOperacoes,
  fatorComposto,
  fatorQuantidade,
  isTipoEventoCorporativo,
  validarEvento,
} from '@/domain/eventosCorporativos'
import type { EventoCorporativo } from '@/domain/eventosCorporativos'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Operacao } from '@/domain/entities'

/**
 * Testes dos eventos corporativos (RF20, Seção 5.6).
 *
 * Regra central: eventos **não** geram lucro/prejuízo — o total investido é
 * preservado e apenas quantidade/preço médio são ajustados.
 */

function evento(
  tipo: EventoCorporativo['tipo'],
  valor: number,
  overrides: Partial<EventoCorporativo> = {},
): EventoCorporativo {
  return {
    id: `evt-${tipo}-${valor}`,
    data: '2026-06-01',
    ticker: 'PETR4',
    categoria: CategoriaAtivo.Acao,
    tipo,
    valor,
    ...overrides,
  }
}

/** Posição inicial: 100 cotas a R$ 10,00 (total investido R$ 1.000,00). */
const POSICAO_BASE = { quantidadeAtual: 100, precoMedio: 1000 }
const TOTAL_BASE = 100 * 1000

describe('fatorQuantidade', () => {
  it('split multiplica a quantidade pelo fator N', () => {
    expect(fatorQuantidade(OperacaoTipo.Split, 2)).toBe(2)
    expect(fatorQuantidade(OperacaoTipo.Split, 10)).toBe(10)
  })

  it('grupamento divide a quantidade pelo fator N', () => {
    expect(fatorQuantidade(OperacaoTipo.Grupamento, 10)).toBeCloseTo(0.1, 10)
  })

  it('bonificação multiplica a quantidade por (1 + x/100)', () => {
    expect(fatorQuantidade(OperacaoTipo.Bonificacao, 10)).toBeCloseTo(1.1, 10)
  })

  it('ignora fatores inválidos (retorna 1)', () => {
    expect(fatorQuantidade(OperacaoTipo.Split, 0)).toBe(1)
    expect(fatorQuantidade(OperacaoTipo.Split, Number.NaN)).toBe(1)
  })
})

describe('aplicarEvento', () => {
  it('split 1:2 → Qtd × 2 e Preço Médio / 2 (sem lucro/prejuízo)', () => {
    const resultado = aplicarEvento(POSICAO_BASE, evento(OperacaoTipo.Split, 2))
    expect(resultado.quantidadeAtual).toBe(200)
    expect(resultado.precoMedio).toBe(500)
    expect(resultado.totalInvestido).toBe(TOTAL_BASE)
  })

  it('grupamento 10:1 → Qtd / 10 e Preço Médio × 10', () => {
    const resultado = aplicarEvento(POSICAO_BASE, evento(OperacaoTipo.Grupamento, 10))
    expect(resultado.quantidadeAtual).toBe(10)
    expect(resultado.precoMedio).toBe(10000)
    expect(resultado.totalInvestido).toBe(TOTAL_BASE)
  })

  it('bonificação 10% → Qtd × 1,1 e Preço Médio / 1,1', () => {
    const resultado = aplicarEvento(POSICAO_BASE, evento(OperacaoTipo.Bonificacao, 10))
    expect(resultado.quantidadeAtual).toBe(110)
    expect(resultado.precoMedio).toBeCloseTo(909.09, 2)
    // Total investido preservado a menos do arredondamento de 2 casas.
    expect(resultado.totalInvestido).toBeCloseTo(TOTAL_BASE, 0)
  })

  it('preserva o total investido em posição zerada (Qtd 0)', () => {
    const resultado = aplicarEvento(
      { quantidadeAtual: 0, precoMedio: 0 },
      evento(OperacaoTipo.Split, 2),
    )
    expect(resultado).toEqual({ quantidadeAtual: 0, precoMedio: 0, totalInvestido: 0 })
  })
})

describe('aplicarEventos (sequência)', () => {
  it('compõe múltiplos eventos na ordem aplicada', () => {
    const eventos = [
      evento(OperacaoTipo.Split, 2),
      evento(OperacaoTipo.Bonificacao, 50),
      evento(OperacaoTipo.Grupamento, 3),
    ]
    // fator = 2 × 1,5 ÷ 3 = 1 → posição inalterada.
    expect(fatorComposto(eventos)).toBeCloseTo(1, 10)
    const resultado = aplicarEventos(POSICAO_BASE, eventos)
    expect(resultado.quantidadeAtual).toBe(100)
    expect(resultado.precoMedio).toBe(1000)
  })

  it('é independente da ordem dos eventos (composição multiplicativa)', () => {
    const eventos = [evento(OperacaoTipo.Split, 3), evento(OperacaoTipo.Bonificacao, 100)]
    const invertido = [...eventos].reverse()
    expect(aplicarEventos(POSICAO_BASE, eventos).quantidadeAtual).toBe(
      aplicarEventos(POSICAO_BASE, invertido).quantidadeAtual,
    )
  })
})

describe('integração com o consolidado (calcularPosicoes)', () => {
  function operacao(partial: Partial<Operacao> & Pick<Operacao, 'ticker' | 'tipo' | 'quantidade'>): Operacao {
    return {
      id: `op-${Math.random().toString(36).slice(2)}`,
      data: '2026-01-01',
      categoria: CategoriaAtivo.Acao,
      precoUnitario: 0,
      taxas: 0,
      indexador: null,
      percentualIndexador: null,
      vencimento: null,
      valorBrutoAtual: null,
      ...partial,
    }
  }

  it('aplica split sobre as compras sem alterar o total investido', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000 }),
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Split, quantidade: 2 }),
    ])

    expect(posicoes[0]).toMatchObject({
      quantidadeAtual: 200,
      precoMedio: 500,
      totalInvestido: 100000,
    })
  })

  it('aplica grupamento sobre as compras sem alterar o total investido', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'VALE3', tipo: OperacaoTipo.Compra, quantidade: 200, precoUnitario: 500 }),
      operacao({ ticker: 'VALE3', tipo: OperacaoTipo.Grupamento, quantidade: 2 }),
    ])

    expect(posicoes[0]).toMatchObject({
      quantidadeAtual: 100,
      precoMedio: 1000,
      totalInvestido: 100000,
    })
  })

  it('aplica bonificação sobre as compras sem alterar o total investido', () => {
    const posicoes = calcularPosicoes([
      operacao({ ticker: 'MXRF11', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000 }),
      operacao({ ticker: 'MXRF11', tipo: OperacaoTipo.Bonificacao, quantidade: 100 }),
    ])

    expect(posicoes[0].quantidadeAtual).toBe(200)
    expect(posicoes[0].totalInvestido).toBe(100000)
    expect(posicoes[0].precoMedio).toBe(500)
  })
})

describe('helpers de evento', () => {
  it('identifica tipos de evento corporativo', () => {
    for (const tipo of EVENTO_CORPORATIVO_TIPOS) {
      expect(isTipoEventoCorporativo(tipo)).toBe(true)
    }
    expect(isTipoEventoCorporativo(OperacaoTipo.Compra)).toBe(false)
    expect(isTipoEventoCorporativo(OperacaoTipo.Venda)).toBe(false)
  })

  it('faz round-trip evento → operação → evento', () => {
    const original = evento(OperacaoTipo.Grupamento, 5, { ticker: 'petr4' })
    const operacao = eventoParaOperacao(original)
    expect(operacao.quantidade).toBe(5)
    expect(operacao.precoUnitario).toBe(0)
    expect(operacao.ticker).toBe('PETR4')
    expect(eventoDeOperacao(operacao)).toMatchObject({
      tipo: OperacaoTipo.Grupamento,
      valor: 5,
      ticker: 'PETR4',
    })
  })

  it('extrai apenas eventos de uma lista de operações', () => {
    const operacoes: Operacao[] = [
      eventoParaOperacao(evento(OperacaoTipo.Split, 2)),
      {
        id: 'c1',
        data: '2026-01-01',
        tipo: OperacaoTipo.Compra,
        categoria: CategoriaAtivo.Acao,
        ticker: 'PETR4',
        quantidade: 10,
        precoUnitario: 1000,
        taxas: 0,
        indexador: null,
        percentualIndexador: null,
        vencimento: null,
        valorBrutoAtual: null,
      },
    ]
    const eventos = eventosDeOperacoes(operacoes)
    expect(eventos).toHaveLength(1)
    expect(eventos[0].tipo).toBe(OperacaoTipo.Split)
  })

  it('descreve o evento em pt-BR', () => {
    expect(descreverEvento(evento(OperacaoTipo.Split, 2))).toBe('Split 1:2')
    expect(descreverEvento(evento(OperacaoTipo.Grupamento, 10))).toBe('Grupamento 10:1')
    expect(descreverEvento(evento(OperacaoTipo.Bonificacao, 10))).toBe('Bonificação 10%')
  })

  it('valida fatores inválidos', () => {
    expect(validarEvento(evento(OperacaoTipo.Split, 2))).toBeNull()
    expect(validarEvento(evento(OperacaoTipo.Split, 1))).not.toBeNull()
    expect(validarEvento(evento(OperacaoTipo.Bonificacao, 0))).not.toBeNull()
    expect(validarEvento(evento(OperacaoTipo.Grupamento, 10, { ticker: '  ' }))).not.toBeNull()
  })
})
