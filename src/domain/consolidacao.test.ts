import { describe, expect, it } from 'vitest'
import {
  analisarPendencias,
  calcularConsolidacao,
  contarProventosComDataInvalida,
  isDataIsoValida,
  precisaConsolidar,
  verificarInvariantes,
} from '@/domain/consolidacao'
import { calcularPosicoes } from '@/domain/consolidado'
import { calcularFluxoRealizado } from '@/domain/detalheAtivo'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'

/**
 * Testes da consolidação do histórico (`PLANO_CONSOLIDACAO.md` §9.1).
 *
 * O foco é a aritmética: os números do app (posição, preço médio, total
 * investido, lucro realizado e proventos por ano/tipo) precisam ficar
 * **idênticos** depois de substituir N linhas por 1 compra + 1 venda.
 */

let sequencia = 0

function id(): string {
  sequencia += 1
  return `op-${String(sequencia).padStart(4, '0')}`
}

interface OperacaoParcial {
  data: string
  tipo: OperacaoTipo
  ticker?: string
  categoria?: CategoriaAtivo
  quantidade?: number
  precoUnitario?: number
  taxas?: number
  id?: string
  indexador?: Operacao['indexador']
  percentualIndexador?: number | null
  vencimento?: string | null
  valorBrutoAtual?: number | null
}

function op(parcial: OperacaoParcial): Operacao {
  return {
    id: parcial.id ?? id(),
    data: parcial.data,
    tipo: parcial.tipo,
    categoria: parcial.categoria ?? CategoriaAtivo.Acao,
    ticker: parcial.ticker ?? 'PETR4',
    quantidade: parcial.quantidade ?? 0,
    precoUnitario: parcial.precoUnitario ?? 0,
    taxas: parcial.taxas ?? 0,
    indexador: parcial.indexador ?? null,
    percentualIndexador: parcial.percentualIndexador ?? null,
    vencimento: parcial.vencimento ?? null,
    valorBrutoAtual: parcial.valorBrutoAtual ?? null,
  }
}

function provento(parcial: Partial<Provento> & { dataPagamento: string }): Provento {
  return {
    id: parcial.id ?? id(),
    dataCom: parcial.dataCom ?? null,
    dataPagamento: parcial.dataPagamento,
    categoria: parcial.categoria ?? CategoriaAtivo.Acao,
    ticker: parcial.ticker ?? 'PETR4',
    tipo: parcial.tipo ?? ProventoTipo.Dividendo,
    valorTotal: parcial.valorTotal ?? 0,
  }
}

function novoIdSequencial(): () => string {
  let contador = 0
  return () => {
    contador += 1
    return `novo-${contador}`
  }
}

function quantidadeDoTicker(operacoes: readonly Operacao[], ticker = 'PETR4'): number {
  return calcularPosicoes(operacoes).find((posicao) => posicao.ticker === ticker)?.quantidadeAtual ?? 0
}

describe('precisaConsolidar', () => {
  it('exige mais de 2 movimentos ou evento corporativo', () => {
    const duas = [
      op({ data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ data: '2023-02-02', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 1200 }),
    ]
    expect(precisaConsolidar(duas, [])).toEqual({ operacoes: false, proventos: false })

    const tres = [
      ...duas,
      op({ data: '2023-03-02', tipo: OperacaoTipo.Compra, quantidade: 5, precoUnitario: 900 }),
    ]
    expect(precisaConsolidar(tres, []).operacoes).toBe(true)

    const comEvento = [
      op({ data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ data: '2023-02-02', tipo: OperacaoTipo.Split, quantidade: 2 }),
      op({ data: '2023-03-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 600 }),
    ]
    expect(precisaConsolidar(comEvento, []).operacoes).toBe(true)
  })

  it('detecta proventos com 2+ linhas no mesmo (ano, tipo)', () => {
    const proventos = [
      provento({ dataPagamento: '2023-03-10', valorTotal: 100 }),
      provento({ dataPagamento: '2023-09-10', valorTotal: 200 }),
      provento({
        dataPagamento: '2023-05-10',
        tipo: ProventoTipo.Jcp,
        valorTotal: 50,
      }),
    ]
    expect(precisaConsolidar([], proventos).proventos).toBe(true)
  })

  it('valida datas ISO (inclusive bissexto)', () => {
    expect(isDataIsoValida('2023-02-28')).toBe(true)
    expect(isDataIsoValida('2024-02-29')).toBe(true)
    expect(isDataIsoValida('2023-02-29')).toBe(false)
    expect(isDataIsoValida('2023-13-01')).toBe(false)
    expect(isDataIsoValida('')).toBe(false)
  })
})

describe('calcularConsolidacao — ticker encerrado', () => {
  const operacoes = [
    op({ id: 'a1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000, taxas: 200 }),
    op({ id: 'a2', data: '2023-02-02', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1100, taxas: 200 }),
    op({ id: 'a3', data: '2023-03-02', tipo: OperacaoTipo.Venda, quantidade: 50, precoUnitario: 1500 }),
    op({ id: 'a4', data: '2023-04-02', tipo: OperacaoTipo.Compra, quantidade: 50, precoUnitario: 900, taxas: 100 }),
    op({ id: 'a5', data: '2023-05-02', tipo: OperacaoTipo.Venda, quantidade: 100, precoUnitario: 1600 }),
    op({ id: 'a6', data: '2023-06-02', tipo: OperacaoTipo.Venda, quantidade: 100, precoUnitario: 1700 }),
  ]

  it('substitui N operações por 1 compra + 1 venda preservando tudo', () => {
    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      operacoes,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    expect(resultado.geradas.operacoes).toHaveLength(2)
    expect(resultado.absorvidas.operacoes).toHaveLength(operacoes.length)
    expect(resultado.operacoes).toHaveLength(2)
    expect(resultado.operacoes.filter((operacao) => operacao.tipo === OperacaoTipo.Compra)).toHaveLength(1)
    expect(resultado.operacoes.filter((operacao) => operacao.tipo === OperacaoTipo.Venda)).toHaveLength(1)

    expect(quantidadeDoTicker(resultado.operacoes)).toBe(0)
    expect(calcularFluxoRealizado('PETR4', resultado.operacoes).lucroRealizado).toBe(
      calcularFluxoRealizado('PETR4', operacoes).lucroRealizado,
    )
    expect(verificarInvariantes(
      { operacoes, proventos: [] },
      { operacoes: resultado.operacoes, proventos: [] },
    )).toEqual([])

    const compra = resultado.operacoes.find((operacao) => operacao.tipo === OperacaoTipo.Compra)
    expect(compra?.data).toBe('2023-01-02')
    expect(compra?.taxas).toBeGreaterThanOrEqual(0)
    expect(compra?.taxas).toBeLessThan(compra?.quantidade ?? 0)
    expect(resultado.operacoes.find((operacao) => operacao.tipo === OperacaoTipo.Venda)?.data).toBe(
      '2023-06-02',
    )
  })

  it('ajusta quantidade por split e grupamento no meio do histórico', () => {
    const comEventos = [
      op({ id: 'b1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 100, precoUnitario: 1000 }),
      op({ id: 'b2', data: '2023-02-02', tipo: OperacaoTipo.Split, quantidade: 2 }),
      op({ id: 'b3', data: '2023-03-02', tipo: OperacaoTipo.Venda, quantidade: 100, precoUnitario: 600 }),
      op({ id: 'b4', data: '2023-04-02', tipo: OperacaoTipo.Grupamento, quantidade: 10 }),
      op({ id: 'b5', data: '2023-05-02', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 6000 }),
    ]

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      comEventos,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    expect(resultado.geradas.operacoes.map((operacao) => operacao.quantidade)).toEqual([20, 20])
    expect(calcularFluxoRealizado('PETR4', resultado.operacoes).lucroRealizado).toBe(
      calcularFluxoRealizado('PETR4', comEventos).lucroRealizado,
    )
    expect(verificarInvariantes(
      { operacoes: comEventos, proventos: [] },
      { operacoes: resultado.operacoes, proventos: [] },
    )).toEqual([])
  })

  it('não infla a quantidade com evento posterior à última venda', () => {
    const comEventoFinal = [
      op({ id: 'c1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'c2', data: '2023-02-02', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 1200 }),
      op({ id: 'c3', data: '2023-03-02', tipo: OperacaoTipo.Split, quantidade: 2 }),
    ]

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      comEventoFinal,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    const compra = resultado.operacoes.find((operacao) => operacao.tipo === OperacaoTipo.Compra)
    expect(compra?.quantidade).toBe(10)
    expect(resultado.absorvidas.operacoes).toHaveLength(3)
  })

  it('mantém o lucro exato quando sobra resíduo de arredondamento', () => {
    const comResiduo = [
      op({ id: 'd1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'd2', data: '2023-02-02', tipo: OperacaoTipo.Venda, quantidade: 3, precoUnitario: 1103 }),
      op({ id: 'd3', data: '2023-03-02', tipo: OperacaoTipo.Venda, quantidade: 7, precoUnitario: 1201 }),
    ]
    const esperado = calcularFluxoRealizado('PETR4', comResiduo).lucroRealizado

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      comResiduo,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    const compra = resultado.operacoes.find((operacao) => operacao.tipo === OperacaoTipo.Compra)
    expect(compra?.taxas).toBe(4)
    expect(compra?.precoUnitario).toBe(999)
    expect(calcularFluxoRealizado('PETR4', resultado.operacoes).lucroRealizado).toBe(esperado)
  })

  it('bloqueia histórico com venda sem posição', () => {
    const vendidoADescoberto = [
      op({ id: 'e1', data: '2023-01-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1000 }),
      op({ id: 'e2', data: '2023-02-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 900 }),
      op({ id: 'e3', data: '2023-03-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 950 }),
    ]

    const pendencias = analisarPendencias(vendidoADescoberto, [], 2026)
    expect(pendencias).toHaveLength(1)
    expect(pendencias[0].estado).toBe('encerrado')
    expect(pendencias[0].impedimento).toMatch(/venda sem posição/)

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      vendidoADescoberto,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(true)
  })

  it('bloqueia histórico fracionário em que o arredondamento do evento cria ações fantasma', () => {
    // 70,19 ÷ 2 = 35,095 → round2 = 35,1: a venda de 35,1 fecha a posição com
    // 0,005 "ações fantasma", então as quantidades não fecham em zero.
    const fracionario = [
      op({ id: 'f1', data: '2020-01-02', tipo: OperacaoTipo.Compra, quantidade: 73, precoUnitario: 289, taxas: 136 }),
      op({ id: 'f2', data: '2020-01-05', tipo: OperacaoTipo.Venda, quantidade: 11.81, precoUnitario: 1389 }),
      op({ id: 'f3', data: '2020-01-09', tipo: OperacaoTipo.Compra, quantidade: 9, precoUnitario: 3597, taxas: 143 }),
      op({ id: 'f4', data: '2020-01-11', tipo: OperacaoTipo.Grupamento, quantidade: 2 }),
      op({ id: 'f5', data: '2020-01-14', tipo: OperacaoTipo.Venda, quantidade: 35.1, precoUnitario: 3393 }),
    ]

    expect(quantidadeDoTicker(fracionario)).toBe(0)
    expect(analisarPendencias(fracionario, [], 2026)[0].impedimento).toMatch(
      /não fecham em quantidade zero/,
    )

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      fracionario,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(true)
  })

  it('copia os metadados de RF/marcação para a linha de maior data', () => {
    const rendaFixa = [
      op({
        id: 'f1',
        data: '2023-01-02',
        tipo: OperacaoTipo.Compra,
        categoria: CategoriaAtivo.TesouroDireto,
        quantidade: 2,
        precoUnitario: 100000,
        indexador: 'IPCA',
        percentualIndexador: 6,
        vencimento: '2030-01-01',
        valorBrutoAtual: 120000,
      }),
      op({
        id: 'f2',
        data: '2023-02-02',
        tipo: OperacaoTipo.Compra,
        categoria: CategoriaAtivo.TesouroDireto,
        quantidade: 1,
        precoUnitario: 101000,
        indexador: 'IPCA',
        percentualIndexador: 6,
        vencimento: '2030-01-01',
        valorBrutoAtual: 130000,
      }),
      op({
        id: 'f3',
        data: '2023-03-02',
        tipo: OperacaoTipo.Venda,
        categoria: CategoriaAtivo.TesouroDireto,
        quantidade: 3,
        precoUnitario: 105000,
        indexador: 'IPCA',
        percentualIndexador: 6,
        vencimento: '2030-01-01',
        valorBrutoAtual: 130000,
      }),
    ]

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      rendaFixa,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    const venda = resultado.operacoes.find((operacao) => operacao.tipo === OperacaoTipo.Venda)
    expect(venda?.vencimento).toBe('2030-01-01')
    expect(venda?.indexador).toBe('IPCA')
    expect(venda?.percentualIndexador).toBe(6)
    expect(venda?.valorBrutoAtual).toBe(130000)
  })
})

describe('calcularConsolidacao — por ano', () => {
  const operacoes = [
    // 2022: ano auto-contido (entra e sai do ano zerado)
    op({ id: 'g1', data: '2022-01-10', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
    op({ id: 'g2', data: '2022-02-10', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1100 }),
    op({ id: 'g3', data: '2022-06-10', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1300 }),
    // 2023: posição aberta no ano (compra e só parte vendida)
    op({ id: 'g4', data: '2023-01-10', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1200 }),
    op({ id: 'g5', data: '2023-07-10', tipo: OperacaoTipo.Venda, quantidade: 4, precoUnitario: 1400 }),
  ]

  it('consolida o ano auto-contido e mantém os anos seguintes intactos', () => {
    const resultado = calcularConsolidacao(
      { tipo: 'ticker-ano', ticker: 'PETR4', ano: 2022, modo: 'Completo' },
      operacoes,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    expect(resultado.absorvidas.operacoes).toHaveLength(3)
    expect(resultado.geradas.operacoes).toHaveLength(2)
    expect(resultado.operacoes.filter((operacao) => operacao.data.startsWith('2023'))).toEqual([
      operacoes[3],
      operacoes[4],
    ])
    expect(resultado.operacoes.find((operacao) => operacao.data === '2022-01-10')?.quantidade).toBe(20)
    expect(resultado.operacoes.some((operacao) => operacao.id === 'g3')).toBe(false)
    expect(resultado.operacoes.find((operacao) => operacao.data === '2022-06-10')?.tipo).toBe(
      OperacaoTipo.Venda,
    )
    expect(quantidadeDoTicker(resultado.operacoes)).toBe(6)
    expect(verificarInvariantes(
      { operacoes, proventos: [] },
      { operacoes: resultado.operacoes, proventos: [] },
    )).toEqual([])
  })

  it('no ano com posição aberta consolida apenas os proventos', () => {
    const proventos = [
      provento({ dataPagamento: '2023-03-10', valorTotal: 300 }),
      provento({ dataPagamento: '2023-09-10', valorTotal: 700 }),
    ]

    const resultado = calcularConsolidacao(
      { tipo: 'ticker-ano', ticker: 'PETR4', ano: 2023, modo: 'SomenteProventos' },
      operacoes,
      proventos,
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    expect(resultado.absorvidas.operacoes).toHaveLength(0)
    expect(resultado.geradas.operacoes).toHaveLength(0)
    expect(resultado.operacoes).toEqual(operacoes)
    expect(resultado.proventos).toHaveLength(1)
    expect(resultado.proventos[0].dataPagamento).toBe('2023-09-10')
    expect(resultado.proventos[0].valorTotal).toBe(1000)
  })

  it('recusa o modo Completo em ano com posição em aberto', () => {
    const resultado = calcularConsolidacao(
      { tipo: 'ticker-ano', ticker: 'PETR4', ano: 2023, modo: 'Completo' },
      operacoes,
      [],
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(true)
  })
})

describe('calcularConsolidacao — proventos', () => {
  it('agrega 1 linha por tipo/ano, na data do último pagamento, preservando a soma', () => {
    const operacoes = [
      op({ id: 'h1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'h2', data: '2023-02-02', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 1200 }),
    ]
    const proventos = [
      provento({ id: 'p1', dataPagamento: '2023-03-10', valorTotal: 100, dataCom: '2023-02-20' }),
      provento({ id: 'p2', dataPagamento: '2023-09-10', valorTotal: 250 }),
      provento({ id: 'p3', dataPagamento: '2023-05-10', tipo: ProventoTipo.Jcp, valorTotal: 50 }),
      provento({ id: 'p4', dataPagamento: '2024-03-10', valorTotal: 400 }),
      provento({ id: 'p5', dataPagamento: '2024-09-10', valorTotal: 600 }),
    ]

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      operacoes,
      proventos,
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    // Grupo de 1 linha (JCP 2023) fica intocado.
    expect(resultado.absorvidas.proventos).toHaveLength(4)
    expect(resultado.proventos).toHaveLength(3)

    const dividendo2023 = resultado.proventos.find(
      (item) => item.dataPagamento === '2023-09-10' && item.tipo === ProventoTipo.Dividendo,
    )
    expect(dividendo2023?.valorTotal).toBe(350)
    expect(dividendo2023?.dataCom).toBeNull()

    const dividendo2024 = resultado.proventos.find(
      (item) => item.dataPagamento === '2024-09-10' && item.tipo === ProventoTipo.Dividendo,
    )
    expect(dividendo2024?.valorTotal).toBe(1000)

    expect(resultado.proventos.find((item) => item.tipo === ProventoTipo.Jcp)?.valorTotal).toBe(50)
    expect(verificarInvariantes(
      { operacoes, proventos },
      { operacoes: resultado.operacoes, proventos: resultado.proventos },
    )).toEqual([])
  })

  it('deixa fora da consolidação os proventos sem data válida', () => {
    const operacoes = [
      op({ id: 'i1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'i2', data: '2023-02-02', tipo: OperacaoTipo.Venda, quantidade: 10, precoUnitario: 1200 }),
    ]
    const proventos = [
      provento({ id: 'q1', dataPagamento: '', valorTotal: 100 }),
      provento({ id: 'q2', dataPagamento: '2023-03-10', valorTotal: 300 }),
      provento({ id: 'q3', dataPagamento: '2023-09-10', valorTotal: 700 }),
    ]

    expect(contarProventosComDataInvalida(proventos)).toBe(1)
    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      operacoes,
      proventos,
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    expect(resultado.proventos).toHaveLength(2)
    expect(resultado.proventos.some((item) => item.id === 'q1')).toBe(true)
  })
})

describe('analisarPendencias', () => {
  it('lista encerrados pendentes e ignora tickers já enxutos', () => {
    const operacoes = [
      op({ id: 'j1', data: '2022-01-02', tipo: OperacaoTipo.Compra, ticker: 'PETR4', quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'j2', data: '2022-01-10', tipo: OperacaoTipo.Compra, ticker: 'PETR4', quantidade: 5, precoUnitario: 1100 }),
      op({ id: 'j3', data: '2022-02-02', tipo: OperacaoTipo.Venda, ticker: 'PETR4', quantidade: 15, precoUnitario: 1200 }),
      op({ id: 'j4', data: '2022-03-02', tipo: OperacaoTipo.Compra, ticker: 'VALE3', quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'j5', data: '2022-04-02', tipo: OperacaoTipo.Venda, ticker: 'VALE3', quantidade: 10, precoUnitario: 1200 }),
    ]

    const pendencias = analisarPendencias(operacoes, [], 2026)
    expect(pendencias.map((item) => item.ticker)).toEqual(['PETR4'])
    expect(pendencias[0].estado).toBe('encerrado')
    expect(pendencias[0].operacoesParaAbsorver).toBe(3)
    expect(pendencias[0].impedimento).toBeNull()
  })

  it('lista anos elegíveis de ticker ativo e exclui o ano corrente', () => {
    const operacoes = [
      op({ id: 'k1', data: '2022-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'k2', data: '2022-02-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1100 }),
      op({ id: 'k3', data: '2022-06-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1300 }),
      op({ id: 'k4', data: '2024-01-02', tipo: OperacaoTipo.Compra, quantidade: 5, precoUnitario: 1200 }),
      op({ id: 'k5', data: '2024-02-02', tipo: OperacaoTipo.Compra, quantidade: 5, precoUnitario: 1250 }),
      op({ id: 'k6', data: '2024-06-02', tipo: OperacaoTipo.Compra, quantidade: 5, precoUnitario: 1300 }),
    ]

    const pendencias = analisarPendencias(operacoes, [], 2026)
    expect(pendencias).toHaveLength(1)
    expect(pendencias[0].estado).toBe('ativo')
    expect(pendencias[0].anos.map((ano) => ano.ano)).toEqual([2022])
    expect(pendencias[0].anos[0].modo).toBe('Completo')
    expect(pendencias[0].anos[0].impedimento).toBeNull()

    const noAnoCorrente = analisarPendencias(operacoes, [], 2024)
    expect(noAnoCorrente[0].anos.map((ano) => ano.ano)).toEqual([2022])
  })

  it('não lista anos com posição aberta sem proventos pendentes', () => {
    const operacoes = [
      op({ id: 'l1', data: '2022-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'l2', data: '2022-02-02', tipo: OperacaoTipo.Venda, quantidade: 5, precoUnitario: 1300 }),
    ]

    expect(analisarPendencias(operacoes, [], 2026)).toEqual([])
  })

  it('marca o ano com posição em aberto como SomenteProventos', () => {
    const operacoes = [
      op({ id: 'm1', data: '2022-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'm2', data: '2022-02-02', tipo: OperacaoTipo.Venda, quantidade: 5, precoUnitario: 1300 }),
    ]
    const proventos = [
      provento({ dataPagamento: '2022-03-10', valorTotal: 100 }),
      provento({ dataPagamento: '2022-09-10', valorTotal: 200 }),
    ]

    const pendencias = analisarPendencias(operacoes, proventos, 2026)
    expect(pendencias).toHaveLength(1)
    expect(pendencias[0].anos).toHaveLength(1)
    expect(pendencias[0].anos[0].modo).toBe('SomenteProventos')
    expect(pendencias[0].anos[0].operacoesParaAbsorver).toBe(0)
    expect(pendencias[0].anos[0].proventosParaAbsorver).toBe(2)
  })

  it('o item deixa de aparecer depois de consolidado', () => {
    const operacoes = [
      op({ id: 'n1', data: '2022-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'n2', data: '2022-02-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1100 }),
      op({ id: 'n3', data: '2022-06-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1300 }),
    ]
    const proventos = [
      provento({ dataPagamento: '2022-03-10', valorTotal: 100 }),
      provento({ dataPagamento: '2022-09-10', valorTotal: 200 }),
    ]

    expect(analisarPendencias(operacoes, proventos, 2026)).toHaveLength(1)

    const resultado = calcularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      operacoes,
      proventos,
      { novoId: novoIdSequencial() },
    )
    expect('erro' in resultado).toBe(false)
    if ('erro' in resultado) return

    expect(analisarPendencias(resultado.operacoes, resultado.proventos, 2026)).toEqual([])
  })
})

describe('verificarInvariantes', () => {
  it('detecta divergência injetada (provento perdido e operação perdida)', () => {
    const operacoes = [
      op({ id: 'o1', data: '2023-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
      op({ id: 'o2', data: '2023-02-02', tipo: OperacaoTipo.Venda, quantidade: 4, precoUnitario: 1200 }),
      op({ id: 'o3', data: '2023-03-02', tipo: OperacaoTipo.Venda, quantidade: 6, precoUnitario: 1300 }),
    ]
    const proventos = [provento({ id: 'r1', dataPagamento: '2023-04-10', valorTotal: 500 })]

    const semProvento = verificarInvariantes(
      { operacoes, proventos },
      { operacoes, proventos: [] },
    )
    expect(semProvento.some((divergencia) => divergencia.metrica.startsWith('Proventos'))).toBe(true)

    const semOperacao = verificarInvariantes(
      { operacoes, proventos },
      { operacoes: operacoes.slice(0, 2), proventos },
    )
    expect(semOperacao.some((divergencia) => divergencia.metrica.startsWith('Quantidade'))).toBe(true)
  })
})

/**
 * Teste de propriedade: gera históricos válidos aleatórios (com split,
 * grupamento, bonificação, eventos após zerar posição, taxas e preços variados)
 * e verifica que a consolidação preserva todas as métricas do app.
 */
describe('calcularConsolidacao — propriedades aleatórias', () => {
  function criarRng(semente: number): () => number {
    let estado = semente >>> 0
    return () => {
      estado = (estado + 0x6d2b79f5) >>> 0
      let valor = estado
      valor = Math.imul(valor ^ (valor >>> 15), valor | 1)
      valor ^= valor + Math.imul(valor ^ (valor >>> 7), valor | 61)
      return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296
    }
  }

  function gerarHistorico(rng: () => number, inicio: number): Operacao[] {
    const lista: Operacao[] = []
    let sequenciaLocal = 0
    let dia = 1
    let quantidade = 0

    const proximaData = (): string => {
      dia += 1 + Math.floor(rng() * 5)
      const mes = Math.min(12, Math.floor((dia - 1) / 28) + 1)
      const diaMes = ((dia - 1) % 28) + 1
      return `${2020 + Math.floor(inicio / 12)}-${String(mes).padStart(2, '0')}-${String(diaMes).padStart(2, '0')}`
    }
    const novaOp = (tipo: OperacaoTipo, quantidadeOp: number, preco = 0, taxas = 0): void => {
      sequenciaLocal += 1
      lista.push(
        op({
          id: `${inicio}-${String(sequenciaLocal).padStart(4, '0')}`,
          data: proximaData(),
          tipo,
          quantidade: quantidadeOp,
          precoUnitario: preco,
          taxas,
        }),
      )
    }
    const comprar = (): void => {
      const qtd = 1 + Math.floor(rng() * 100)
      novaOp(OperacaoTipo.Compra, qtd, 100 + Math.floor(rng() * 4900), Math.floor(rng() * 300))
      quantidade = Math.round((quantidade + qtd) * 100) / 100
    }
    const vender = (): void => {
      if (quantidade <= 0) return
      const qtd =
        rng() < 0.5 || quantidade <= 1
          ? quantidade
          : Math.min(quantidade, Math.max(1, Math.floor(quantidade * rng())))
      if (qtd <= 0) return
      novaOp(OperacaoTipo.Venda, qtd, 100 + Math.floor(rng() * 4900))
      quantidade = Math.round((quantidade - qtd) * 100) / 100
    }

    /** Aplica o evento só quando o resultado tem no máximo 2 casas (sem perda). */
    const aplicarEvento = (tipo: OperacaoTipo): boolean => {
      const exato = tipo === OperacaoTipo.Split ? quantidade * 2 : quantidade / 2
      if (Math.abs(Math.round((exato + Number.EPSILON) * 100) / 100 - exato) > 1e-9) return false
      novaOp(tipo, 2)
      quantidade = exato
      return true
    }

    comprar()
    const acoes = 1 + Math.floor(rng() * 14)
    for (let passo = 0; passo < acoes; passo += 1) {
      const sorteio = rng()
      if (sorteio < 0.4) {
        comprar()
      } else if (sorteio < 0.7) {
        vender()
      } else if (sorteio < 0.85) {
        aplicarEvento(OperacaoTipo.Split)
      } else {
        aplicarEvento(OperacaoTipo.Grupamento)
      }
      // Evento depois de zerar a posição (deve ser absorvido sem inflar Q).
      if (quantidade === 0 && rng() < 0.5) {
        novaOp(OperacaoTipo.Split, 2)
      }
    }

    if (quantidade <= 0) comprar()
    novaOp(OperacaoTipo.Venda, quantidade, 100 + Math.floor(rng() * 4900))
    return lista
  }

  it('preserva posição, preço médio, lucro e totais em 300 históricos', () => {
    for (let semente = 1; semente <= 300; semente += 1) {
      const operacoes = gerarHistorico(criarRng(semente), semente)
      expect(quantidadeDoTicker(operacoes)).toBe(0)

      const resultado = calcularConsolidacao(
        { tipo: 'ticker', ticker: 'PETR4' },
        operacoes,
        [],
        { novoId: novoIdSequencial() },
      )
      expect('erro' in resultado, `semente ${semente}: ${'erro' in resultado ? resultado.erro : ''}`).toBe(false)
      if ('erro' in resultado) continue

      expect(
        verificarInvariantes(
          { operacoes, proventos: [] },
          { operacoes: resultado.operacoes, proventos: [] },
        ),
        `semente ${semente}`,
      ).toEqual([])
      expect(calcularFluxoRealizado('PETR4', resultado.operacoes).lucroRealizado).toBe(
        calcularFluxoRealizado('PETR4', operacoes).lucroRealizado,
      )
    }
  })
})
