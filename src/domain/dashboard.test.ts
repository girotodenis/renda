import { describe, expect, it } from 'vitest'
import {
  agruparAtivosParaTabela,
  agruparAtivosPorCategoria,
  agruparProventosPorAno,
  agruparProventosPorMes,
  agruparProventosPorTicker,
  agruparProventosPorTipo,
  alocacaoPorAtivo,
  alocacaoPorCategoria,
  anosComProventos,
  ativosParaTabela,
  filtrarProventos,
  posicoesAbertas,
  posicoesEncerradas,
  serieEvolucao,
  tickersParaNavegacao,
  totalProventos,
} from '@/domain/dashboard'
import { CategoriaAtivo, ProventoTipo } from '@/domain/entities'
import type { Consolidado, Provento, Snapshot } from '@/domain/entities'

/** Convenção: dinheiro em centavos. Ex.: `R$ 10,00` → `1000`. */

function consolidado(partial: Partial<Consolidado> & Pick<Consolidado, 'ticker'>): Consolidado {
  return {
    categoria: CategoriaAtivo.Acao,
    quantidadeAtual: 10,
    precoMedio: 1000,
    precoAtual: 1000,
    totalInvestido: 10000,
    valorAtual: 10000,
    lucroPrejuizo: 0,
    lucroPrejuizoPercent: 0,
    percentualCarteira: 0,
    ...partial,
  }
}

function provento(
  partial: Partial<Provento> & Pick<Provento, 'ticker' | 'dataPagamento' | 'valorTotal'>,
): Provento {
  return {
    id: `pv-${partial.ticker}-${partial.dataPagamento}`,
    dataCom: null,
    categoria: CategoriaAtivo.Acao,
    tipo: ProventoTipo.Dividendo,
    ...partial,
  }
}

describe('posicoesAbertas / ativosParaTabela (RF10)', () => {
  it('ignora posições zeradas e tickers vazios', () => {
    const linhas = [
      consolidado({ ticker: 'PETR4' }),
      consolidado({ ticker: 'ITSA4', quantidadeAtual: 0, valorAtual: 0 }),
      consolidado({ ticker: '   ' }),
    ]
    expect(posicoesAbertas(linhas).map((linha) => linha.ticker)).toEqual(['PETR4'])
  })

  it('ordena por valor atual decrescente', () => {
    const linhas = [
      consolidado({ ticker: 'A', valorAtual: 10000 }),
      consolidado({ ticker: 'B', valorAtual: 50000 }),
      consolidado({ ticker: 'C', valorAtual: 30000 }),
    ]
    expect(ativosParaTabela(linhas).map((linha) => linha.ticker)).toEqual(['B', 'C', 'A'])
  })
})

describe('posicoesEncerradas (ativos completamente vendidos)', () => {
  it('mantém apenas posições zeradas com ticker preenchido', () => {
    const linhas = [
      consolidado({ ticker: 'PETR4' }),
      consolidado({ ticker: 'ITSA4', quantidadeAtual: 0, valorAtual: 0 }),
      consolidado({ ticker: '   ', quantidadeAtual: 0 }),
    ]
    expect(posicoesEncerradas(linhas).map((linha) => linha.ticker)).toEqual(['ITSA4'])
  })
})

describe('agruparAtivosParaTabela (abas Em carteira / Vendidos)', () => {
  it('separa posições abertas e ativos vendidos por categoria', () => {
    const linhas = [
      consolidado({ ticker: 'PETR4', categoria: CategoriaAtivo.Acao, valorAtual: 12000 }),
      consolidado({
        ticker: 'ITSA4',
        categoria: CategoriaAtivo.Acao,
        quantidadeAtual: 0,
        valorAtual: 0,
      }),
      consolidado({ ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, valorAtual: 6000 }),
    ]

    const grupos = agruparAtivosParaTabela(linhas)

    // Todas as categorias canônicas aparecem, mesmo as sem itens (tabelas vazias).
    expect(grupos.map((grupo) => grupo.categoria)).toEqual([
      CategoriaAtivo.Acao,
      CategoriaAtivo.Bdr,
      CategoriaAtivo.Etf,
      CategoriaAtivo.Fii,
      CategoriaAtivo.TesouroDireto,
      CategoriaAtivo.RendaFixa,
    ])
    const acao = grupos[0]
    const fii = grupos[3]
    expect(acao.abertos.map((ativo) => ativo.ticker)).toEqual(['PETR4'])
    expect(acao.encerrados.map((ativo) => ativo.ticker)).toEqual(['ITSA4'])
    expect(fii.abertos.map((ativo) => ativo.ticker)).toEqual(['MXRF11'])
    expect(fii.encerrados).toEqual([])
    // O consolidador considera apenas as posições abertas.
    expect(acao.valorAtual).toBe(12000)
  })

  it('inclui categoria com apenas ativos vendidos e ordena os encerrados por ticker', () => {
    const linhas = [
      consolidado({ ticker: 'VALE3', categoria: CategoriaAtivo.Acao }),
      consolidado({
        ticker: 'BBDC4',
        categoria: CategoriaAtivo.Acao,
        quantidadeAtual: 0,
        valorAtual: 0,
      }),
      consolidado({
        ticker: 'ABEV3',
        categoria: CategoriaAtivo.Acao,
        quantidadeAtual: 0,
        valorAtual: 0,
      }),
      consolidado({
        ticker: 'HGLG11',
        categoria: CategoriaAtivo.Fii,
        quantidadeAtual: 0,
        valorAtual: 0,
      }),
    ]

    const grupos = agruparAtivosParaTabela(linhas)
    const acao = grupos[0]
    const fii = grupos[3]

    expect(acao.encerrados.map((ativo) => ativo.ticker)).toEqual(['ABEV3', 'BBDC4'])
    // FII aparece por causa dos ativos vendidos (sem posições abertas).
    expect(fii.abertos).toEqual([])
    expect(fii.encerrados.map((ativo) => ativo.ticker)).toEqual(['HGLG11'])
    expect(fii.valorAtual).toBe(0)
  })

  it('devolve todas as categorias canônicas mesmo sem nenhuma posição', () => {
    const grupos = agruparAtivosParaTabela([])

    expect(grupos.map((grupo) => grupo.categoria)).toEqual([
      CategoriaAtivo.Acao,
      CategoriaAtivo.Bdr,
      CategoriaAtivo.Etf,
      CategoriaAtivo.Fii,
      CategoriaAtivo.TesouroDireto,
      CategoriaAtivo.RendaFixa,
    ])
    expect(
      grupos.every((grupo) => grupo.abertos.length === 0 && grupo.encerrados.length === 0),
    ).toBe(true)
  })
})

describe('tickersParaNavegacao (anterior/próximo no detalhe do ativo)', () => {
  it('segue a ordem da tabela: categoria canônica, abertos (valor desc) e vendidos (ticker asc)', () => {
    const linhas = [
      consolidado({ ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, valorAtual: 5000 }),
      consolidado({ ticker: 'ITSA4', categoria: CategoriaAtivo.Acao, valorAtual: 9000 }),
      consolidado({ ticker: 'PETR4', categoria: CategoriaAtivo.Acao, valorAtual: 12000 }),
      consolidado({
        ticker: 'ABEV3',
        categoria: CategoriaAtivo.Acao,
        quantidadeAtual: 0,
        valorAtual: 0,
      }),
    ]

    expect(tickersParaNavegacao(linhas)).toEqual(['PETR4', 'ITSA4', 'ABEV3', 'MXRF11'])
  })

  it('ignora tickers vazios e devolve lista vazia sem posições', () => {
    expect(tickersParaNavegacao([])).toEqual([])
    expect(tickersParaNavegacao([consolidado({ ticker: '   ' })])).toEqual([])
  })
})

describe('alocação (RF08)', () => {
  it('agrupa por categoria e calcula o percentual', () => {
    const linhas = [
      consolidado({ ticker: 'PETR4', categoria: CategoriaAtivo.Acao, valorAtual: 60000 }),
      consolidado({ ticker: 'VALE3', categoria: CategoriaAtivo.Acao, valorAtual: 20000 }),
      consolidado({ ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, valorAtual: 20000 }),
    ]
    const resultado = alocacaoPorCategoria(linhas)
    expect(resultado.map((item) => item.rotulo)).toEqual(['Ação', 'FII'])
    expect(resultado[0]).toMatchObject({ valor: 80000, percentual: 80 })
    expect(resultado[1]).toMatchObject({ valor: 20000, percentual: 20 })
  })

  it('agrupa por ativo e ignora posições zeradas', () => {
    const linhas = [
      consolidado({ ticker: 'PETR4', valorAtual: 50000 }),
      consolidado({ ticker: 'ITSA4', quantidadeAtual: 0, valorAtual: 0 }),
      consolidado({ ticker: 'MXRF11', valorAtual: 50000 }),
    ]
    const resultado = alocacaoPorAtivo(linhas)
    expect(resultado).toHaveLength(2)
    expect(resultado.map((item) => item.chave)).toEqual(['PETR4', 'MXRF11'])
    expect(resultado[0].percentual).toBe(50)
  })
})

describe('agruparAtivosPorCategoria (tabela por categoria)', () => {
  it('agrupa na ordem canônica e consolida os totais', () => {
    const linhas = [
      consolidado({
        ticker: 'PETR4',
        categoria: CategoriaAtivo.Acao,
        totalInvestido: 10000,
        valorAtual: 12000,
      }),
      consolidado({
        ticker: 'VALE3',
        categoria: CategoriaAtivo.Acao,
        totalInvestido: 5000,
        valorAtual: 4000,
      }),
      consolidado({
        ticker: 'MXRF11',
        categoria: CategoriaAtivo.Fii,
        totalInvestido: 5000,
        valorAtual: 6000,
      }),
    ]

    const grupos = agruparAtivosPorCategoria(linhas)

    expect(grupos.map((grupo) => grupo.categoria)).toEqual([CategoriaAtivo.Acao, CategoriaAtivo.Fii])
    const acao = grupos[0]
    expect(acao.quantidadePosicoes).toBe(2)
    expect(acao.totalInvestido).toBe(15000)
    expect(acao.valorAtual).toBe(16000)
    expect(acao.lucroPrejuizo).toBe(1000)
    expect(acao.lucroPrejuizoPercent).toBeCloseTo(6.67, 1)
    // Total da carteira = 16.000 (Ação) + 6.000 (FII) = 22.000.
    expect(acao.percentualCarteira).toBeCloseTo(72.73, 1)
    expect(grupos[1].percentualCarteira).toBeCloseTo(27.27, 1)
  })

  it('ignora posições zeradas e categorias sem posições', () => {
    const linhas = [
      consolidado({ ticker: 'PETR4', categoria: CategoriaAtivo.Acao }),
      consolidado({ ticker: 'ZERA', categoria: CategoriaAtivo.Fii, quantidadeAtual: 0, valorAtual: 0 }),
    ]
    const grupos = agruparAtivosPorCategoria(linhas)
    expect(grupos.map((grupo) => grupo.categoria)).toEqual([CategoriaAtivo.Acao])
  })
})

describe('agregações de proventos (RF11)', () => {
  const proventos = [
    provento({ ticker: 'PETR4', dataPagamento: '2026-03-15', valorTotal: 10000 }),
    provento({ ticker: 'PETR4', dataPagamento: '2026-06-15', valorTotal: 5000 }),
    provento({
      ticker: 'MXRF11',
      dataPagamento: '2026-06-20',
      valorTotal: 2000,
      tipo: ProventoTipo.Rendimento,
    }),
    provento({ ticker: 'VALE3', dataPagamento: '2025-12-01', valorTotal: 3000 }),
  ]

  it('agrupa por ano em ordem decrescente', () => {
    expect(agruparProventosPorAno(proventos)).toEqual([
      { chave: '2026', rotulo: '2026', valorTotal: 17000 },
      { chave: '2025', rotulo: '2025', valorTotal: 3000 },
    ])
    expect(anosComProventos(proventos)).toEqual(['2026', '2025'])
  })

  it('agrupa por mês com rótulo pt-BR', () => {
    const meses = agruparProventosPorMes(proventos)
    expect(meses[0]).toMatchObject({ chave: '2026-06', valorTotal: 7000 })
    expect(meses[0].rotulo).toContain('2026')
  })

  it('agrupa por ticker e por tipo', () => {
    expect(agruparProventosPorTicker(proventos)).toEqual([
      { chave: 'MXRF11', rotulo: 'MXRF11', valorTotal: 2000 },
      { chave: 'PETR4', rotulo: 'PETR4', valorTotal: 15000 },
      { chave: 'VALE3', rotulo: 'VALE3', valorTotal: 3000 },
    ])
    const tipos = agruparProventosPorTipo(proventos)
    expect(tipos).toEqual([
      { chave: ProventoTipo.Dividendo, rotulo: ProventoTipo.Dividendo, valorTotal: 18000 },
      { chave: ProventoTipo.Rendimento, rotulo: ProventoTipo.Rendimento, valorTotal: 2000 },
    ])
  })

  it('filtra por ano e por mês e soma o total', () => {
    const doAno = filtrarProventos(proventos, { ano: '2026' })
    expect(doAno).toHaveLength(3)
    expect(totalProventos(doAno)).toBe(17000)

    const doMes = filtrarProventos(proventos, { mes: '2026-06' })
    expect(totalProventos(doMes)).toBe(7000)
  })
})

describe('serieEvolucao (RF09)', () => {
  it('ordena snapshots por data crescente e rotula em DD/MM/AAAA', () => {
    const historico: Snapshot[] = [
      { data: '2026-03-01', patrimonioTotal: 300, totalInvestido: 200, lucroAcumulado: 100 },
      { data: '2026-01-01', patrimonioTotal: 100, totalInvestido: 100, lucroAcumulado: 0 },
      { data: '', patrimonioTotal: 0, totalInvestido: 0, lucroAcumulado: 0 },
    ]
    const serie = serieEvolucao(historico)
    expect(serie.map((ponto) => ponto.data)).toEqual(['2026-01-01', '2026-03-01'])
    expect(serie[0].rotulo).toBe('01/01/2026')
    expect(serie[1].patrimonioTotal).toBe(300)
  })
})
