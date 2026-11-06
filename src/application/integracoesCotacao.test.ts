import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testarIntegracoesCotacao } from '@/application/integracoesCotacao'

/**
 * Testes do teste de integrações do diagnóstico: uma requisição por integração,
 * cota repassada para a tela e falhas isoladas (nunca lança).
 */

const mocks = vi.hoisted(() => ({
  carregarConfiguracoes: vi.fn(),
  testarBrapi: vi.fn(),
}))

vi.mock('@/application/configuracoes', () => ({
  carregarConfiguracoes: mocks.carregarConfiguracoes,
}))

vi.mock('@/infrastructure/cotacoes/registro', () => ({
  integracoesCotacao: [
    {
      id: 'brapi',
      nome: 'Brapi',
      site: 'https://brapi.dev',
      exigeToken: true,
      teste: { testar: mocks.testarBrapi },
      limparCache: () => {},
    },
    {
      id: 'planilha-google',
      nome: 'Planilha Google',
      site: 'https://docs.google.com/spreadsheets',
      exigeToken: false,
      limparCache: () => {},
    },
  ],
  provedorListaTickers: { listar: vi.fn() },
}))

const contexto = { accessToken: 'token-google', spreadsheetId: 'banco-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.carregarConfiguracoes.mockResolvedValue({ tokens: { brapi: 'chave-brapi' } })
  mocks.testarBrapi.mockResolvedValue({
    ok: true,
    mensagem: 'Conexão OK — cotação de PETR4 obtida.',
    quota: { limite: 15000, restante: 14990, reinicioEmSegundos: 3600 },
    testadoEm: '2026-11-06T12:00:00.000Z',
  })
})

describe('testarIntegracoesCotacao', () => {
  it('testa cada integração com os tokens da aba Configuracoes', async () => {
    const resultado = await testarIntegracoesCotacao(contexto)

    expect(mocks.carregarConfiguracoes).toHaveBeenCalledWith(contexto)
    expect(mocks.testarBrapi).toHaveBeenCalledWith({
      tokens: { brapi: 'chave-brapi' },
      accessToken: 'token-google',
      forceRefresh: true,
    })
    expect(resultado.testes[0]).toMatchObject({
      id: 'brapi',
      tokenConfigurado: true,
      resultado: { ok: true, quota: { restante: 14990 } },
    })
    // Integração sem `teste` não quebra o relatório.
    expect(resultado.testes[1]).toMatchObject({
      id: 'planilha-google',
      tokenConfigurado: true,
      resultado: { ok: false },
    })
    // Fontes opcionais (sem token) não invalidam o resultado geral.
    expect(resultado.todasOk).toBe(true)
  })

  it('marca token ausente quando a integração exige chave', async () => {
    mocks.carregarConfiguracoes.mockResolvedValue({ tokens: {} })
    mocks.testarBrapi.mockResolvedValue({
      ok: false,
      mensagem: 'Token não configurado — a integração fica desligada.',
      quota: null,
      testadoEm: null,
    })

    const resultado = await testarIntegracoesCotacao(contexto)

    expect(resultado.testes[0]).toMatchObject({
      tokenConfigurado: false,
      resultado: { ok: false },
    })
    expect(resultado.todasOk).toBe(false)
  })

  it('isola falhas inesperadas de um adaptador', async () => {
    mocks.testarBrapi.mockRejectedValue(new Error('boom'))

    const resultado = await testarIntegracoesCotacao(contexto)

    expect(resultado.testes[0].resultado).toMatchObject({
      ok: false,
      mensagem: 'Falha inesperada ao testar a integração.',
    })
  })

  it('sem banco ativo testa com tokens vazios', async () => {
    await testarIntegracoesCotacao(null)

    expect(mocks.carregarConfiguracoes).not.toHaveBeenCalled()
    expect(mocks.testarBrapi).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: {}, accessToken: undefined }),
    )
  })
})
