import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Configuracao } from '@/domain/entities'
import { carregarConfiguracoes, salvarConfiguracoes } from '@/application/configuracoes'

/** Aba `Configuracoes` em memória — o mesmo repositório serve Sheets e banco JSON. */
const estado = vi.hoisted(() => ({ linhas: [] as Configuracao[] }))

const mocks = vi.hoisted(() => ({
  ensureRequiredSheets: vi.fn(),
}))

vi.mock('@/infrastructure/sheets/gatewayRouter', () => ({
  ensureRequiredSheets: mocks.ensureRequiredSheets,
}))

vi.mock('@/infrastructure/repositories', () => ({
  configuracoesRepo: {
    readCache: () => estado.linhas,
    refresh: async () => estado.linhas,
    list: async () => estado.linhas,
    replaceAll: async (_contexto: unknown, linhas: Configuracao[]) => {
      estado.linhas = [...linhas]
    },
  },
}))

const context = { accessToken: 'token', spreadsheetId: 'planilha' }

beforeEach(() => {
  estado.linhas = []
  vi.clearAllMocks()
})

describe('configurações das integrações', () => {
  it('salva um token por integração e lê de volta', async () => {
    await salvarConfiguracoes(context, { tokens: { brapi: 'token-brapi', maisretorno: 'mr_abc' } })

    expect(estado.linhas).toEqual([
      { chave: 'brapi_token', valor: 'token-brapi' },
      { chave: 'maisretorno_token', valor: 'mr_abc' },
    ])
    expect(mocks.ensureRequiredSheets).toHaveBeenCalledWith('token', 'planilha')
    expect((await carregarConfiguracoes(context)).tokens).toEqual({
      brapi: 'token-brapi',
      maisretorno: 'mr_abc',
    })
  })

  it('preserva chaves desconhecidas ao salvar (configurações de outras versões)', async () => {
    estado.linhas = [
      { chave: 'tema', valor: 'escuro' },
      { chave: 'brapi_token', valor: 'antigo' },
    ]

    await salvarConfiguracoes(context, { tokens: { brapi: 'novo' } })

    expect(estado.linhas).toEqual([
      { chave: 'tema', valor: 'escuro' },
      { chave: 'brapi_token', valor: 'novo' },
    ])
  })

  it('limpar um token mantém a chave com valor vazio (integração desligada)', async () => {
    estado.linhas = [
      { chave: 'brapi_token', valor: 'abc' },
      { chave: 'maisretorno_token', valor: 'mr_abc' },
    ]

    await salvarConfiguracoes(context, { tokens: { brapi: 'abc', maisretorno: '' } })

    expect((await carregarConfiguracoes(context)).tokens).toEqual({ brapi: 'abc', maisretorno: '' })
  })

  it('offline usa o cache e nunca lança quando a aba ainda não existe', async () => {
    expect((await carregarConfiguracoes(context, true)).tokens).toEqual({})
  })
})
