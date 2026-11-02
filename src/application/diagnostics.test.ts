import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGNOSTIC_TICKER,
  lerDiagnosticoAmbiente,
  runDataLayerDiagnostics,
} from '@/application/diagnostics'

/**
 * Testes do bloco de **estado do ambiente** do diagnóstico (Fase 9).
 *
 * O objetivo é provar três coisas: o bloco traduz o estado do gateway e da
 * planilha, nunca derruba o diagnóstico quando a leitura falha e não contamina
 * os contadores de requisição (a leitura do magic acontece depois de fechá-los).
 */

const mocks = vi.hoisted(() => {
  const state = { requests: 0 }

  const repo = () => ({
    append: vi.fn(async () => {
      state.requests += 1
    }),
    newId: vi.fn(() => 'id-teste'),
    readCache: vi.fn(() => []),
  })

  return {
    state,
    estadoDoBanco: vi.fn(),
    estadoPlanilhaCotacoes: vi.fn(),
    criptografiaDisponivel: vi.fn(() => true),
    getSheetsRequestCount: vi.fn(() => state.requests),
    resetSheetsRequestCount: vi.fn(() => {
      state.requests = 0
    }),
    operacoesRepo: repo(),
    proventosRepo: repo(),
    consolidadoRepo: repo(),
    metasRepo: repo(),
    historicoRepo: repo(),
    prefetchAllSheets: vi.fn(async () => {
      state.requests += 1
    }),
  }
})

vi.mock('@/application/criptografia', () => ({ estadoDoBanco: mocks.estadoDoBanco }))

vi.mock('@/application/planilhaCotacoes', () => ({
  estadoPlanilhaCotacoes: mocks.estadoPlanilhaCotacoes,
}))

vi.mock('@/infrastructure/sheets/gatewayRouter', () => ({
  criptografiaDisponivel: mocks.criptografiaDisponivel,
  getSheetsRequestCount: mocks.getSheetsRequestCount,
  resetSheetsRequestCount: mocks.resetSheetsRequestCount,
}))

vi.mock('@/infrastructure/repositories', () => ({
  operacoesRepo: mocks.operacoesRepo,
  proventosRepo: mocks.proventosRepo,
  consolidadoRepo: mocks.consolidadoRepo,
  metasRepo: mocks.metasRepo,
  historicoRepo: mocks.historicoRepo,
  prefetchAllSheets: mocks.prefetchAllSheets,
}))

const contexto = { accessToken: 'token', spreadsheetId: 'banco-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.requests = 0
  mocks.criptografiaDisponivel.mockReturnValue(true)
  mocks.estadoPlanilhaCotacoes.mockReturnValue({ estado: 'nao-autorizada', motivo: null })
  mocks.estadoDoBanco.mockResolvedValue({ estado: 'nenhuma', bloqueado: false, disponivel: true })
})

describe('lerDiagnosticoAmbiente', () => {
  it('traduz o estado do banco e o da planilha de cotações', async () => {
    mocks.estadoDoBanco.mockResolvedValue({ estado: 'total', bloqueado: true, disponivel: true })
    mocks.estadoPlanilhaCotacoes.mockReturnValue({
      estado: 'indisponivel',
      motivo: 'Planilha apagada.',
    })

    await expect(lerDiagnosticoAmbiente(contexto)).resolves.toEqual({
      criptografia: { estado: 'total', bloqueado: true, disponivel: true },
      planilhaCotacoes: { estado: 'indisponivel', motivo: 'Planilha apagada.' },
    })
  })

  it('degrada para o estado conhecido quando a leitura do arquivo falha', async () => {
    mocks.estadoDoBanco.mockRejectedValue(new Error('offline'))
    mocks.criptografiaDisponivel.mockReturnValue(false)
    mocks.estadoPlanilhaCotacoes.mockReturnValue({ estado: 'ativa', motivo: null })

    await expect(lerDiagnosticoAmbiente(contexto)).resolves.toEqual({
      criptografia: { estado: 'nenhuma', bloqueado: false, disponivel: false },
      planilhaCotacoes: { estado: 'ativa', motivo: null },
    })
  })

  it('sem banco ativo não consulta o gateway', async () => {
    await expect(lerDiagnosticoAmbiente(null)).resolves.toEqual({
      criptografia: { estado: 'nenhuma', bloqueado: false, disponivel: true },
      planilhaCotacoes: { estado: 'nao-autorizada', motivo: null },
    })
    expect(mocks.estadoDoBanco).not.toHaveBeenCalled()
  })
})

describe('runDataLayerDiagnostics', () => {
  it('inclui o estado do ambiente sem contá-lo nos contadores', async () => {
    mocks.estadoDoBanco.mockImplementation(async () => {
      mocks.state.requests += 1
      return { estado: 'total', bloqueado: false, disponivel: true }
    })
    mocks.estadoPlanilhaCotacoes.mockReturnValue({ estado: 'ativa', motivo: null })

    const report = await runDataLayerDiagnostics(contexto)

    expect(report.ticker).toBe(DIAGNOSTIC_TICKER)
    expect(report.writeRequests).toBe(5)
    expect(report.refreshRequests).toBe(1)
    expect(report.cacheReadRequests).toBe(0)
    expect(report.cacheReadUsedNoRequests).toBe(true)
    // 5 escritas + 1 refresh: a leitura do magic ficou fora do total.
    expect(report.totalRequests).toBe(6)
    expect(report.criptografia).toEqual({ estado: 'total', bloqueado: false, disponivel: true })
    expect(report.planilhaCotacoes).toEqual({ estado: 'ativa', motivo: null })
  })

  it('não falha quando a leitura do ambiente falha', async () => {
    mocks.estadoDoBanco.mockRejectedValue(new Error('403'))

    const report = await runDataLayerDiagnostics(contexto)

    expect(report.criptografia.estado).toBe('nenhuma')
    expect(report.planilhaCotacoes.estado).toBe('nao-autorizada')
    expect(report.sheets).toHaveLength(5)
  })
})
