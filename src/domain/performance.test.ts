import { describe, expect, it } from 'vitest'
import { calcularConsolidado } from '@/domain/consolidado'
import {
  desempenhoDaCarteira,
  diasEntre,
  fluxosParaXirr,
  subperiodosDaCarteira,
  twr,
  valorPresenteLiquido,
  xirr,
} from '@/domain/performance'
import type { FluxoDatado, Subperiodo } from '@/domain/performance'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/domain/entities'
import type { Operacao, Provento, Snapshot } from '@/domain/entities'

/**
 * Testes de XIRR (dinheiro) e TWR (tempo).
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

function provento(partial: Partial<Provento> & { dataPagamento: string; valorTotal: number }): Provento {
  return {
    id: `prov-${partial.ticker ?? 'PETR4'}-${partial.dataPagamento}`,
    dataCom: null,
    categoria: CategoriaAtivo.Acao,
    ticker: 'PETR4',
    tipo: ProventoTipo.Dividendo,
    ...partial,
  }
}

function snapshot(partial: Snapshot): Snapshot {
  return partial
}

describe('diasEntre', () => {
  it('conta dias corridos entre datas ISO', () => {
    expect(diasEntre('2020-01-01', '2020-12-31')).toBe(365) // 2020 é bissexto
    expect(diasEntre('2021-01-01', '2023-01-01')).toBe(730)
    expect(diasEntre('2026-01-10', '2026-01-10')).toBe(0)
  })
})

describe('xirr', () => {
  it('encontra 10% a.a. em um ano exato', () => {
    const fluxos: FluxoDatado[] = [
      { data: '2020-01-01', valor: -100000 },
      { data: '2020-12-31', valor: 110000 },
    ]

    expect(xirr(fluxos)).toBeCloseTo(0.1, 8)
    expect(valorPresenteLiquido(fluxos, 0.1)).toBeCloseTo(0, 6)
  })

  it('encontra 10% a.a. composto em dois anos', () => {
    const fluxos: FluxoDatado[] = [
      { data: '2021-01-01', valor: -100000 },
      { data: '2023-01-01', valor: 121000 },
    ]

    expect(xirr(fluxos)).toBeCloseTo(0.1, 8)
  })

  it('devolve taxa negativa quando há prejuízo', () => {
    const fluxos: FluxoDatado[] = [
      { data: '2021-01-01', valor: -100000 },
      { data: '2022-01-01', valor: 90000 },
    ]

    expect(xirr(fluxos)).toBeCloseTo(-0.1, 6)
  })

  it('considera aportes intermediários', () => {
    // R$ 1.000 hoje + R$ 1.000 em 6 meses → R$ 2.100 no fim de 1 ano.
    const fluxos: FluxoDatado[] = [
      { data: '2025-01-01', valor: -100000 },
      { data: '2025-07-02', valor: -100000 },
      { data: '2026-01-01', valor: 210000 },
    ]
    const taxa = xirr(fluxos)

    expect(taxa).not.toBeNull()
    expect(taxa! > 0.05 && taxa! < 0.07).toBe(true)
  })

  it('aguenta séries longas e convergentes (2 mil fluxos)', () => {
    // Série determinística: 2.000 aportes semanais negativos e um resgate final.
    const fluxos: FluxoDatado[] = []
    const inicio = Date.UTC(2000, 0, 1)
    let total = 0
    for (let indice = 0; indice < 2000; indice += 1) {
      const data = new Date(inicio + indice * 7 * 86_400_000).toISOString().slice(0, 10)
      fluxos.push({ data, valor: -1000 })
      total += 1000
    }
    const fim = new Date(inicio + 2000 * 7 * 86_400_000).toISOString().slice(0, 10)
    fluxos.push({ data: fim, valor: total * 1.5 })

    const taxa = xirr(fluxos)
    expect(taxa).not.toBeNull()
    expect(Number.isFinite(taxa!)).toBe(true)
    expect(taxa!).toBeGreaterThan(0)
  })

  it('devolve null quando não há troca de sinal ou há menos de dois fluxos', () => {
    expect(xirr([])).toBeNull()
    expect(xirr([{ data: '2026-01-01', valor: -1000 }])).toBeNull()
    expect(
      xirr([
        { data: '2026-01-01', valor: -1000 },
        { data: '2026-02-01', valor: -500 },
      ]),
    ).toBeNull()
  })

  it('consolida fluxos da mesma data', () => {
    const fluxos: FluxoDatado[] = [
      { data: '2020-01-01', valor: -50000 },
      { data: '2020-01-01', valor: -50000 },
      { data: '2020-12-31', valor: 110000 },
    ]

    expect(xirr(fluxos)).toBeCloseTo(0.1, 8)
  })
})

describe('twr', () => {
  it('encadeia geometricamente os subperíodos', () => {
    const subperiodos: Subperiodo[] = [
      {
        dataInicial: '2026-01-01',
        dataFinal: '2026-06-30',
        valorInicial: 100000,
        valorFinal: 110000,
        fluxoLiquido: 0,
      },
      {
        dataInicial: '2026-06-30',
        dataFinal: '2026-12-31',
        valorInicial: 110000,
        valorFinal: 99000,
        fluxoLiquido: 0,
      },
    ]

    const resultado = twr(subperiodos)
    expect(resultado?.acumulado).toBeCloseTo(-0.01, 10)
    expect(resultado?.subperiodos).toBe(2)
  })

  it('desconta o fluxo do valor final (aportes não contam como retorno)', () => {
    const resultado = twr([
      {
        dataInicial: '2026-01-01',
        dataFinal: '2026-12-31',
        valorInicial: 100000,
        valorFinal: 160000,
        fluxoLiquido: 50000,
      },
    ])

    expect(resultado?.acumulado).toBeCloseTo(0.1, 10)
  })

  it('ignora subperíodos sem base e devolve null quando nenhum serve', () => {
    expect(
      twr([
        {
          dataInicial: '2026-01-01',
          dataFinal: '2026-12-31',
          valorInicial: 0,
          valorFinal: 1000,
          fluxoLiquido: 1000,
        },
      ]),
    ).toBeNull()
  })

  it('anualiza pelo número de dias encadeados', () => {
    const resultado = twr([
      {
        dataInicial: '2026-01-01',
        dataFinal: '2026-12-31',
        valorInicial: 100000,
        valorFinal: 110000,
        fluxoLiquido: 0,
      },
    ])

    expect(resultado?.dias).toBe(364)
    expect(resultado?.anualizado).toBeCloseTo(Math.pow(1.1, 365 / 364) - 1, 10)
  })
})

describe('fluxosParaXirr', () => {
  it('gera compras negativas, vendas/proventos positivos e o valor final', () => {
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
        quantidade: 100,
        precoUnitario: 1200,
        taxas: 20,
        data: '2026-02-02',
      }),
      operacao({
        ticker: 'MXRF11',
        tipo: OperacaoTipo.Compra,
        quantidade: 100,
        precoUnitario: 500,
        data: '2026-01-05',
        categoria: CategoriaAtivo.Fii,
      }),
    ]
    const proventos = [
      // data-com durante a posse → conta
      provento({ dataCom: '2026-01-10', dataPagamento: '2026-01-20', valorTotal: 300 }),
      // data-com depois de vender tudo → não conta
      provento({ dataCom: '2026-03-01', dataPagamento: '2026-03-10', valorTotal: 700 }),
      // pagamento após a data de referência → fora
      provento({ dataPagamento: '2027-01-10', valorTotal: 900 }),
    ]

    const fluxos = fluxosParaXirr({
      operacoes,
      proventos,
      valorFinal: 60000,
      dataFinal: '2026-12-31',
    })

    expect(fluxos).toEqual([
      { data: '2026-01-02', valor: -100050 },
      { data: '2026-01-05', valor: -50000 },
      { data: '2026-01-20', valor: 300 },
      { data: '2026-02-02', valor: 119980 },
      { data: '2026-12-31', valor: 60000 },
    ])
  })

  it('filtra por ticker', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000, data: '2026-01-02' }),
      operacao({ ticker: 'MXRF11', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 100, data: '2026-01-02' }),
    ]

    const fluxos = fluxosParaXirr({
      operacoes,
      proventos: [],
      valorFinal: 12000,
      dataFinal: '2026-12-31',
      ticker: 'PETR4',
    })

    expect(fluxos).toEqual([
      { data: '2026-01-02', valor: -10000 },
      { data: '2026-12-31', valor: 12000 },
    ])
  })
})

describe('subperiodosDaCarteira', () => {
  it('monta um subperíodo por intervalo de snapshot com o fluxo líquido', () => {
    const historico: Snapshot[] = [
      snapshot({ data: '2026-01-31', patrimonioTotal: 100000, totalInvestido: 90000, lucroAcumulado: 10000 }),
      snapshot({ data: '2026-02-28', patrimonioTotal: 125000, totalInvestido: 100000, lucroAcumulado: 25000 }),
    ]
    const operacoes = [
      // antes do 1º snapshot → fora
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 5, precoUnitario: 1000, data: '2026-01-05' }),
      // dentro do intervalo → aporte de 10.000
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000, data: '2026-02-10' }),
    ]
    const proventos = [provento({ dataPagamento: '2026-02-15', valorTotal: 500 })]

    const subperiodos = subperiodosDaCarteira(historico, operacoes, proventos)

    expect(subperiodos).toEqual([
      {
        dataInicial: '2026-01-31',
        dataFinal: '2026-02-28',
        valorInicial: 100000,
        valorFinal: 125000,
        fluxoLiquido: 10000 - 500,
      },
    ])

    const resultado = twr(subperiodos)
    // (125.000 − 9.500) ÷ 100.000 − 1 = 15,5%
    expect(resultado?.acumulado).toBeCloseTo(0.155, 10)
  })

  it('devolve vazio com menos de dois snapshots', () => {
    expect(
      subperiodosDaCarteira(
        [snapshot({ data: '2026-01-31', patrimonioTotal: 100000, totalInvestido: 0, lucroAcumulado: 0 })],
        [],
        [],
      ),
    ).toEqual([])
  })
})

describe('desempenhoDaCarteira', () => {
  it('devolve XIRR e TWR da carteira', () => {
    const operacoes = [
      operacao({ ticker: 'PETR4', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, data: '2026-01-05' }),
    ]
    const consolidado = calcularConsolidado(operacoes, new Map([['PETR4', 1200]]))
    const historico: Snapshot[] = [
      snapshot({ data: '2026-01-31', patrimonioTotal: 100000, totalInvestido: 100000, lucroAcumulado: 0 }),
      snapshot({ data: '2026-12-31', patrimonioTotal: 120000, totalInvestido: 100000, lucroAcumulado: 20000 }),
    ]

    const desempenho = desempenhoDaCarteira(
      consolidado,
      operacoes,
      [],
      historico,
      '2026-12-31',
    )

    expect(desempenho.inicio).toBe('2026-01-31')
    expect(desempenho.fim).toBe('2026-12-31')
    expect(desempenho.twr).toBeCloseTo(0.2, 10)
    expect(desempenho.xirr).not.toBeNull()
    expect(desempenho.xirr!).toBeGreaterThan(0.2)
  })

  it('devolve métricas nulas sem dados', () => {
    const desempenho = desempenhoDaCarteira([], [], [], [], '2026-12-31')
    expect(desempenho).toEqual({
      xirr: null,
      twr: null,
      twrAnualizado: null,
      inicio: null,
      fim: null,
    })
  })
})
