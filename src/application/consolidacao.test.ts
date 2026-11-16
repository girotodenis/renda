import { describe, expect, it } from 'vitest'
import {
  carregarPainelConsolidacao,
  executarConsolidacao,
  simularConsolidacao,
} from '@/application/consolidacao'
import type { ConsolidacaoDependencies } from '@/application/consolidacao'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'
import type { RepositoryContext } from '@/domain/repositories/ports'

/**
 * Testes do caso de uso da consolidação (§9.2) — repositórios falsos em memória,
 * sem rede/IndexedDB. Cobrem as guardas, a verificação de invariantes
 * bloqueante, a gravação em lote e o escopo restrito ao ticker escolhido.
 */

const context: RepositoryContext = { accessToken: 'token', spreadsheetId: 'banco' }

let sequencia = 0

function op(parcial: Partial<Operacao> & { data: string; tipo: OperacaoTipo }): Operacao {
  sequencia += 1
  return {
    id: parcial.id ?? `op-${sequencia}`,
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
  sequencia += 1
  return {
    id: parcial.id ?? `prov-${sequencia}`,
    dataCom: parcial.dataCom ?? null,
    dataPagamento: parcial.dataPagamento,
    categoria: parcial.categoria ?? CategoriaAtivo.Acao,
    ticker: parcial.ticker ?? 'PETR4',
    tipo: parcial.tipo ?? ProventoTipo.Dividendo,
    valorTotal: parcial.valorTotal ?? 0,
  }
}

const operacoesIniciais = (): Operacao[] => [
  op({ id: 'p1', data: '2022-01-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1000 }),
  op({ id: 'p2', data: '2022-02-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 1100 }),
  op({ id: 'p3', data: '2022-06-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1300 }),
  op({ id: 'v1', data: '2022-01-03', tipo: OperacaoTipo.Compra, ticker: 'VALE3', quantidade: 5, precoUnitario: 500 }),
]

const proventosIniciais = (): Provento[] => [
  provento({ id: 'd1', dataPagamento: '2022-03-10', valorTotal: 100 }),
  provento({ id: 'd2', dataPagamento: '2022-09-10', valorTotal: 250 }),
]

interface Fakes {
  deps: Partial<ConsolidacaoDependencies>
  estado: { operacoes: Operacao[]; proventos: Provento[] }
  chamadas: {
    replaceOperacoes: number
    replaceProventos: number
    lotes: number
    sincronizacoes: number
    refreshes: number
  }
}

function criarFakes(
  overrides: Partial<ConsolidacaoDependencies> = {},
): Fakes {
  const estado = { operacoes: operacoesIniciais(), proventos: proventosIniciais() }
  const chamadas = {
    replaceOperacoes: 0,
    replaceProventos: 0,
    lotes: 0,
    sincronizacoes: 0,
    refreshes: 0,
  }

  const deps: Partial<ConsolidacaoDependencies> = {
    listOperacoes: async () => estado.operacoes.map((item) => ({ ...item })),
    listProventos: async () => estado.proventos.map((item) => ({ ...item })),
    refreshOperacoes: async () => {
      chamadas.refreshes += 1
      return estado.operacoes.map((item) => ({ ...item }))
    },
    refreshProventos: async () => {
      chamadas.refreshes += 1
      return estado.proventos.map((item) => ({ ...item }))
    },
    replaceOperacoes: async (_context, operacoes) => {
      chamadas.replaceOperacoes += 1
      estado.operacoes = operacoes.map((item) => ({ ...item }))
    },
    replaceProventos: async (_context, proventos) => {
      chamadas.replaceProventos += 1
      estado.proventos = proventos.map((item) => ({ ...item }))
    },
    executarEmLote: async (_context, fn) => {
      chamadas.lotes += 1
      return fn()
    },
    sincronizar: async () => {
      chamadas.sincronizacoes += 1
    },
    isOnline: () => true,
    isModoLocal: () => false,
    agora: () => new Date('2026-06-01T12:00:00Z'),
    novoId: (() => {
      let contador = 0
      return () => {
        contador += 1
        return `novo-${contador}`
      }
    })(),
    ...overrides,
  }

  return { deps, estado, chamadas }
}

describe('carregarPainelConsolidacao', () => {
  it('lista pendências e devolve as listas cruas com contagem de datas inválidas', async () => {
    const fakes = criarFakes()
    fakes.estado.proventos.push(
      provento({ id: 'invalido', dataPagamento: 'sem-data', valorTotal: 50 }),
    )

    const painel = await carregarPainelConsolidacao(context, { deps: fakes.deps })

    expect(painel.anoCorrente).toBe(2026)
    expect(painel.pendencias).toHaveLength(1)
    expect(painel.pendencias[0].ticker).toBe('PETR4')
    expect(painel.pendencias[0].operacoesParaAbsorver).toBe(3)
    expect(painel.pendencias[0].proventosParaAbsorver).toBe(2)
    expect(painel.proventosComDataInvalida).toBe(1)
    expect(painel.operacoes).toHaveLength(4)
  })

  it('propaga forceRefresh para as duas abas', async () => {
    const fakes = criarFakes()
    const forcados: boolean[] = []
    fakes.deps.listOperacoes = async (_context, forceRefresh) => {
      forcados.push(forceRefresh)
      return []
    }
    fakes.deps.listProventos = async (_context, forceRefresh) => {
      forcados.push(forceRefresh)
      return []
    }

    await carregarPainelConsolidacao(context, { forceRefresh: true, deps: fakes.deps })
    expect(forcados).toEqual([true, true])
  })
})

describe('executarConsolidacao', () => {
  it('relê, grava as duas abas em lote e preserva os demais tickers', async () => {
    const fakes = criarFakes()

    const resultado = await executarConsolidacao(
      context,
      { tipo: 'ticker', ticker: 'PETR4' },
      { deps: fakes.deps },
    )

    expect(resultado.absorvidas).toBe(5)
    expect(resultado.geradas).toBe(3)
    expect(resultado.resumo.totalCompras).toBe(21000)
    expect(resultado.resumo.totalVendas).toBe(26000)
    expect(resultado.resumo.totalProventos).toBe(350)

    expect(fakes.chamadas.refreshes).toBe(2)
    expect(fakes.chamadas.lotes).toBe(1)
    expect(fakes.chamadas.replaceOperacoes).toBe(1)
    expect(fakes.chamadas.replaceProventos).toBe(1)
    expect(fakes.chamadas.sincronizacoes).toBe(1)

    const petr4 = fakes.estado.operacoes.filter((item) => item.ticker === 'PETR4')
    expect(petr4).toHaveLength(2)
    expect(petr4.map((item) => item.tipo).sort()).toEqual([
      OperacaoTipo.Compra,
      OperacaoTipo.Venda,
    ])
    expect(fakes.estado.operacoes.some((item) => item.id === 'v1')).toBe(true)
    expect(fakes.estado.proventos).toHaveLength(1)
    expect(fakes.estado.proventos[0].valorTotal).toBe(350)
  })

  it('bloqueia offline antes de qualquer escrita', async () => {
    const fakes = criarFakes({ isOnline: () => false, isModoLocal: () => false })

    await expect(
      executarConsolidacao(context, { tipo: 'ticker', ticker: 'PETR4' }, { deps: fakes.deps }),
    ).rejects.toThrow(/Conecte-se à internet/)

    expect(fakes.chamadas.refreshes).toBe(0)
    expect(fakes.chamadas.replaceOperacoes).toBe(0)
    expect(fakes.chamadas.replaceProventos).toBe(0)
  })

  it('executa offline no modo local (IndexedDB)', async () => {
    const fakes = criarFakes({ isOnline: () => false, isModoLocal: () => true })

    const resultado = await executarConsolidacao(
      context,
      { tipo: 'ticker', ticker: 'PETR4' },
      { deps: fakes.deps },
    )
    expect(resultado.geradas).toBe(3)
    expect(fakes.chamadas.replaceOperacoes).toBe(1)
  })

  it('recusa consolidar o ano corrente', async () => {
    const fakes = criarFakes()

    await expect(
      executarConsolidacao(
        context,
        { tipo: 'ticker-ano', ticker: 'PETR4', ano: 2026, modo: 'Completo' },
        { deps: fakes.deps },
      ),
    ).rejects.toThrow(/anos anteriores ao ano corrente/)

    expect(fakes.chamadas.refreshes).toBe(0)
  })

  it('aborta sem gravar quando a verificação de invariantes diverge', async () => {
    const fakes = criarFakes({
      verificarInvariantes: () => [
        { metrica: 'Lucro realizado de PETR4', esperado: 100, obtido: 90 },
      ],
    })

    await expect(
      executarConsolidacao(context, { tipo: 'ticker', ticker: 'PETR4' }, { deps: fakes.deps }),
    ).rejects.toThrow(/integridade/)

    expect(fakes.chamadas.replaceOperacoes).toBe(0)
    expect(fakes.chamadas.replaceProventos).toBe(0)
    expect(fakes.chamadas.sincronizacoes).toBe(0)
  })

  it('aborta sem gravar quando o domínio recusa o histórico', async () => {
    const fakes = criarFakes()
    fakes.estado.operacoes = [
      op({ id: 'x1', data: '2022-01-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1000 }),
      op({ id: 'x2', data: '2022-02-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 900 }),
      op({ id: 'x3', data: '2022-03-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 950 }),
    ]

    await expect(
      executarConsolidacao(context, { tipo: 'ticker', ticker: 'PETR4' }, { deps: fakes.deps }),
    ).rejects.toThrow(/venda sem posição/)

    expect(fakes.chamadas.replaceOperacoes).toBe(0)
    expect(fakes.chamadas.sincronizacoes).toBe(0)
  })
})

describe('simularConsolidacao', () => {
  it('calcula sem gravar e devolve o erro de histórico inválido', () => {
    const operacoes = operacoesIniciais()
    const simulado = simularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      operacoes,
      proventosIniciais(),
    )

    expect('erro' in simulado).toBe(false)
    if ('erro' in simulado) return
    expect(simulado.geradas.operacoes).toHaveLength(2)
    expect(operacoes).toHaveLength(4)

    const invalido = simularConsolidacao(
      { tipo: 'ticker', ticker: 'PETR4' },
      [
        op({ data: '2022-01-02', tipo: OperacaoTipo.Venda, quantidade: 20, precoUnitario: 1000 }),
        op({ data: '2022-02-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 900 }),
        op({ data: '2022-03-02', tipo: OperacaoTipo.Compra, quantidade: 10, precoUnitario: 950 }),
      ],
      [],
    )
    expect('erro' in invalido).toBe(true)
  })
})
