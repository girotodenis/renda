import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Consolidado, Operacao } from '@/domain/entities'
import { carregarDashboard } from '@/application/dashboard'

const mocks = vi.hoisted(() => ({
  isModoLocal: vi.fn(),
  buscarCotacoesBrapi: vi.fn(),
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
  buscarCotacoesBrapi: mocks.buscarCotacoesBrapi,
  lerCotacaoCache: mocks.lerCotacaoCacheBrapi,
}))

vi.mock('@/application/configuracoes', () => ({
  carregarConfiguracoes: mocks.carregarConfiguracoes,
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
    mocks.buscarCotacoesBrapi.mockResolvedValue(new Map())
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

    expect(mocks.buscarCotacoesBrapi).not.toHaveBeenCalled()
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 12000,
      fonte: 'googlefinance',
    })
  })

  it('atualiza pela Brapi mesmo quando o Consolidado local já tem um preço estático', async () => {
    mocks.isModoLocal.mockReturnValue(true)
    mocks.buscarCotacoesBrapi.mockResolvedValue(new Map([['PETR4', 15500]]))

    const dashboard = await carregarDashboard({
      accessToken: 'local',
      spreadsheetId: 'local',
    })

    expect(mocks.buscarCotacoesBrapi).toHaveBeenCalledWith(['PETR4'], {
      token: 'token-brapi',
    })
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 15500,
      fonte: 'brapi',
    })
  })

  it('preserva o último preço local se a Brapi não retornar uma cotação', async () => {
    mocks.isModoLocal.mockReturnValue(true)

    const dashboard = await carregarDashboard({
      accessToken: 'local',
      spreadsheetId: 'local',
    })

    expect(mocks.buscarCotacoesBrapi).toHaveBeenCalledWith(['PETR4'], {
      token: 'token-brapi',
    })
    expect(dashboard.cotacoes.get('PETR4')).toMatchObject({
      precoAtual: 12000,
      fonte: 'brapi',
    })
  })
})
