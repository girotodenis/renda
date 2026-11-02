import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MSG_PLANILHA_NAO_AUTORIZADA,
  autorizarPlanilhaCotacoes,
  desconectarPlanilhaCotacoes,
  estadoPlanilhaCotacoes,
} from '@/application/planilhaCotacoes'
import { integracaoPlanilhaGoogle } from '@/infrastructure/cotacoes/planilhaGoogle'
import {
  _resetEstadoForTests,
  estadoPlanilhaGoogle,
} from '@/infrastructure/cotacoes/planilhaGoogle'
import {
  PLANILHA_STORAGE_KEY,
  _resetPlanilhaForTests,
} from '@/infrastructure/cotacoes/planilhaGoogle/planilha'
import { SHEETS_SCOPE, googleConfig } from '@/infrastructure/googleConfig'
import { _resetForTests as resetKvForTests } from '@/infrastructure/kvStore'

/** Testes da autorização explícita da planilha de cotações (§6.5). */

const mocks = vi.hoisted(() => ({
  requestAccessToken: vi.fn(),
  isUserCancellation: vi.fn(),
  toStoredToken: vi.fn(),
}))

vi.mock('@/infrastructure/googleIdentity', () => ({
  requestAccessToken: mocks.requestAccessToken,
  isUserCancellation: mocks.isUserCancellation,
  toStoredToken: mocks.toStoredToken,
}))

vi.mock('@/infrastructure/googleConfig', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/googleConfig')>()
  return { ...real, googleConfig: { ...real.googleConfig, clientId: null as string | null } }
})

const armazenamento = new Map<string, string>()
let tokenSalvo: { accessToken: string; scope: string; expiresAt: number } | null = null

vi.mock('@/infrastructure/storage', () => ({
  readStorageJson: (chave: string) => {
    const valor = armazenamento.get(chave)
    return valor === undefined ? null : JSON.parse(valor)
  },
  writeStorageJson: (chave: string, valor: unknown) => {
    armazenamento.set(chave, JSON.stringify(valor))
  },
  removeStorageKey: (chave: string) => {
    armazenamento.delete(chave)
  },
  tokenStorage: {
    load: () => tokenSalvo,
    save: (token: typeof tokenSalvo) => {
      tokenSalvo = token
    },
    clear: () => {
      tokenSalvo = null
    },
  },
}))

const TOKEN_PLANILHA = {
  accessToken: 'token-novo',
  scope: `https://www.googleapis.com/auth/drive.file ${SHEETS_SCOPE}`,
  expiresAt: Date.now() + 3_600_000,
}

function recusa403(): Response {
  return {
    ok: false,
    status: 403,
    json: async () => ({ error: { status: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' } }),
  } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  armazenamento.clear()
  tokenSalvo = null
  resetKvForTests()
  _resetPlanilhaForTests()
  _resetEstadoForTests()
  googleConfig.clientId = 'client-teste'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('autorizarPlanilhaCotacoes', () => {
  it('cancelamento do usuário vira "negada" sem lançar e sem salvar token', async () => {
    mocks.requestAccessToken.mockRejectedValue(new Error('popup_closed'))
    mocks.isUserCancellation.mockReturnValue(true)

    const resultado = await autorizarPlanilhaCotacoes()

    expect(resultado).toEqual({ status: 'negada' })
    expect(tokenSalvo).toBeNull()
    expect(estadoPlanilhaCotacoes().estado).toBe('nao-autorizada')
    expect(MSG_PLANILHA_NAO_AUTORIZADA).toContain('cotações usam as APIs')
  })

  it('sucesso salva o token e zera o estado memorizado', async () => {
    // Falha anterior memorizada: a planilha ficou `indisponivel` na sessão.
    tokenSalvo = {
      accessToken: 'token-antigo',
      scope: SHEETS_SCOPE,
      expiresAt: Date.now() + 3_600_000,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => recusa403()),
    )
    await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4'], {
      tokens: {},
      accessToken: 'token-antigo',
    })
    expect(estadoPlanilhaGoogle().estado).toBe('indisponivel')

    mocks.requestAccessToken.mockResolvedValue({ access_token: 'token-novo' })
    mocks.toStoredToken.mockReturnValue(TOKEN_PLANILHA)

    const resultado = await autorizarPlanilhaCotacoes()

    expect(resultado).toEqual({ status: 'autorizada' })
    expect(mocks.requestAccessToken).toHaveBeenCalledWith({
      clientId: 'client-teste',
      scopes: expect.arrayContaining([SHEETS_SCOPE]) as unknown,
      prompt: 'consent',
    })
    expect(tokenSalvo).toEqual(TOKEN_PLANILHA)
    // Estado memorizado zerado: volta a derivar do token (agora com escopo).
    expect(estadoPlanilhaGoogle()).toEqual({ estado: 'ativa', motivo: null })
    expect(estadoPlanilhaCotacoes()).toEqual({ estado: 'ativa', motivo: null })
  })

  it('devolve erro claro quando não há client id configurado', async () => {
    googleConfig.clientId = null

    const resultado = await autorizarPlanilhaCotacoes()

    expect(resultado.status).toBe('erro')
    expect(mocks.requestAccessToken).not.toHaveBeenCalled()
  })
})

describe('desconectarPlanilhaCotacoes', () => {
  it('esquece o id salvo e o estado, sem mexer no token', () => {
    armazenamento.set(PLANILHA_STORAGE_KEY, JSON.stringify('planilha-1'))
    tokenSalvo = TOKEN_PLANILHA

    desconectarPlanilhaCotacoes()

    expect(armazenamento.has(PLANILHA_STORAGE_KEY)).toBe(false)
    expect(tokenSalvo).toEqual(TOKEN_PLANILHA)
    expect(estadoPlanilhaGoogle()).toEqual({ estado: 'nao-autorizada', motivo: null })
    expect(estadoPlanilhaCotacoes()).toEqual({ estado: 'nao-autorizada', motivo: null })
  })
})
