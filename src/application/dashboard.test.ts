import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Consolidado, Operacao } from '@/domain/entities'
import { carregarDashboard } from '@/application/dashboard'

const mocks = vi.hoisted(() => ({
  isModoLocal: vi.fn(),
  atualizarCotacoesBrapi: vi.fn(),
  lerCotacaoCacheBrapi: vi.fn(),
  carregarConfiguracoes: vi.fn(),
  prefetchAllSheets: vi.fn(),
  operacoesReadCache: vi.fn(),
  proventosReadCache: vi.fn(),
  consolidadoReadCache: vi.fn(),
  historicoReadCache: vi.fn(),
  valuationReadCache: vi.fn(),
  valuationList: vi.fn(),
}))

vi.mock('@/infrastructure/modoArmazenamento', () => ({
  isModoLocal: mocks.isModoLocal,
}))

vi.mock('@/infrastructure/brapi', () => ({
  atualizarCotacoesBrapi: mocks.atualizarCotacoesBrapi,
  lerCotacaoCache: mocks.lerCotacaoCacheBrapi,
}))

vi.mock('@/application/configuracoes', () => ({
  carregarConfiguracoes: mocks.carregarConfiguracoes,
}))

vi.mock('@/application/consolidado', () => ({
  garantirColunasConsolidado: vi.fn().mockResolvedValue(false),
  syncConsolidado: vi.fn(),
}))

vi.mock('@/infrastructure/repositories', () => ({
  consolidadoRepo: { readCache: mocks.consolidadoReadCache },
  historicoRepo: { readCache: mocks.historicoReadCache },
  operacoesRepo: { readCache: mocks.operacoesReadCache },
  prefetchAllSheets: mocks.prefetchAllSheets,
  proventosRepo: { readCache: mocks.proventosReadCache },
  valuationRepo: {
    readCache: mocks.valuationReadCache,
    list: mocks.valuationList,
  },
}))

const operacao: Operacao = {
  id: 'operacao-petr4',
  data: '2026-10-01',
  tipo: OperacaoTipo.Compra,
  categoria: CategoriaAtivo.Acao,
  ticker: 'PETR4',
  quantidade: 2,
  precoUnitario: 10000,
  taxas: 0,
  indexador: null,
  percentualIndexador: null,
  vencimento: null,
  valorBrutoAtual: null,
}

const consolidado: Consolidado = {
  ticker: 'PETR4',
  categoria: CategoriaAtivo.Acao,
  quantidadeAtual: 2,
  precoMedio: 10000,
  precoAtual: 12000,
  totalInvestido: 20000,
  valorAtual: 24000,
  lucroPrejuizo: 4000,
  lucroPrejuizoPercent: 20,
  percentualCarteira: 100,
}

describe('carregarDashboard — cotações Brapi no modo local', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isModoLocal.mockReturnValue(false)
    mocks.atualizarCotacoesBrapi.mockResolvedValue({
      cotacoes: new Map(),
      semCotacao: [],
      semToken: false,
      consultouRede: true,
    })
    mocks.lerCotacaoCacheBrapi.mockReturnValue(null)
    mocks.carregarConfiguracoes.mockResolvedValue({ brapiToken: 'token-brapi' })
    mocks.operacoesReadCache.mockReturnValue([operacao])
    mocks.proventosReadCache.mockReturnValue([])
    mocks.consolidadoReadCache.mockReturnValue([consolidado])
    mocks.historicoReadCache.mockReturnValue([])
    mocks.valuationReadCache.mockReturnValue([])
    mocks.valuationList.mockResolvedValue([])
  })

  it('usa o valor do GoogleFinance sem consultar Brapi no modo Google', async () => {
    const dashboard = await carregarDashboard({
      accessToken: 'access-token',
      spreadsheetId: 'planilha',
    })

    expect(mocks.atualizarCotacoesBrapi).not.toHaveBeenCalled()
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 12000,
      fonte: 'googlefinance',
    })
  })

  it('atualiza pela Brapi mesmo quando o Consolidado local já tem um preço estático', async () => {
    mocks.isModoLocal.mockReturnValue(true)
    mocks.atualizarCotacoesBrapi.mockResolvedValue({
      cotacoes: new Map([
        ['PETR4', { preco: 15500, precoAbertura: 15000, atualizadoEm: null, fonte: 'api' }],
      ]),
      semCotacao: [],
      semToken: false,
      consultouRede: true,
    })

    const dashboard = await carregarDashboard({
      accessToken: 'local',
      spreadsheetId: 'local',
    })

    expect(mocks.atualizarCotacoesBrapi).toHaveBeenCalledWith(['PETR4'], {
      token: 'token-brapi',
      forceRefresh: false,
    })
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 15500,
      fonte: 'brapi',
    })
  })

  it('no refresh explícito consulta a Brapi para todos os ativos e prioriza o preço novo', async () => {
    mocks.atualizarCotacoesBrapi.mockResolvedValue({
      cotacoes: new Map([
        ['PETR4', { preco: 13000, precoAbertura: 12500, atualizadoEm: null, fonte: 'api' }],
      ]),
      semCotacao: [],
      semToken: false,
      consultouRede: true,
    })

    const dashboard = await carregarDashboard(
      { accessToken: 'access-token', spreadsheetId: 'planilha' },
      { forceRefresh: true },
    )

    // O Consolidado já tem preço (12000), mas a atualização manual busca de novo.
    expect(mocks.atualizarCotacoesBrapi).toHaveBeenCalledWith(['PETR4'], {
      token: 'token-brapi',
      forceRefresh: true,
    })
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 13000,
      precoAbertura: 12500,
      variacaoDiaPercent: 4,
      fonte: 'brapi',
    })
    expect(dashboard.cotacoesBrapi).toMatchObject({
      total: 1,
      comCotacao: 1,
      semCotacao: [],
      semToken: false,
      forcado: true,
    })
  })

  it('sem token da Brapi, informa a integração desligada no diagnóstico', async () => {
    mocks.carregarConfiguracoes.mockResolvedValue({ brapiToken: '' })
    mocks.consolidadoReadCache.mockReturnValue([])
    mocks.atualizarCotacoesBrapi.mockResolvedValue({
      cotacoes: new Map(),
      semCotacao: ['PETR4'],
      semToken: true,
      consultouRede: false,
    })

    const dashboard = await carregarDashboard(
      { accessToken: 'access-token', spreadsheetId: 'planilha' },
      { forceRefresh: true },
    )

    expect(dashboard.cotacoesBrapi).toMatchObject({
      total: 1,
      comCotacao: 0,
      semCotacao: ['PETR4'],
      semToken: true,
    })
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({ status: 'indisponivel' })
  })

  it('preserva o último preço local se a Brapi não retornar uma cotação', async () => {
    mocks.isModoLocal.mockReturnValue(true)

    const dashboard = await carregarDashboard({
      accessToken: 'local',
      spreadsheetId: 'local',
    })

    expect(mocks.atualizarCotacoesBrapi).toHaveBeenCalledWith(['PETR4'], {
      token: 'token-brapi',
      forceRefresh: false,
    })
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 12000,
      fonte: 'brapi',
    })
  })
})
