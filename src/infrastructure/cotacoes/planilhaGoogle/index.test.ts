import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cadeiaCotacoesB3 } from '@/domain/provedoresCotacao'
import type { IntegracaoCotacao } from '@/domain/provedoresCotacao'
import { integracaoPlanilhaGoogle } from '@/infrastructure/cotacoes/planilhaGoogle'
import {
  _resetEstadoForTests,
  estadoPlanilhaGoogle,
  lerCotacaoPlanilhaCache,
} from '@/infrastructure/cotacoes/planilhaGoogle'
import {
  PLANILHA_STORAGE_KEY,
  _resetPlanilhaForTests,
} from '@/infrastructure/cotacoes/planilhaGoogle/planilha'
import { SHEETS_SCOPE } from '@/infrastructure/googleConfig'
import { _resetForTests as resetKvForTests } from '@/infrastructure/kvStore'

/** Testes dos três estados da integração e do fallback da cadeia. */

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

const TOKEN = 'token-google'

function resposta(json: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as unknown as Response
}

function recusar(status: number, motivo: string): Response {
  return resposta({ error: { status: motivo, message: motivo } }, status)
}

function stubFetch(
  impl: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: string) => impl(url))
  vi.stubGlobal('fetch', spy)
  return spy
}

/** Stub da Sheets API com a planilha salva e um preço válido para PETR4. */
function stubSheets(leitura: unknown[][]): ReturnType<typeof vi.fn> {
  return stubFetch((url) => {
    if (url.includes('/values/')) {
      const decodificada = decodeURIComponent(url)
      if (decodificada.endsWith('A2:A')) {
        return resposta({ values: [['PETR4'], ['VALE3']] })
      }
      return resposta({ values: leitura })
    }
    return resposta({
      properties: { locale: 'pt_BR' },
      sheets: [{ properties: { sheetId: 0, title: 'Cotações' } }],
    })
  })
}

beforeEach(() => {
  armazenamento.clear()
  resetKvForTests()
  _resetPlanilhaForTests()
  _resetEstadoForTests()
  tokenSalvo = {
    accessToken: TOKEN,
    scope: `https://www.googleapis.com/auth/drive.file ${SHEETS_SCOPE}`,
    expiresAt: Date.now() + 3_600_000,
  }
  armazenamento.set(PLANILHA_STORAGE_KEY, JSON.stringify('planilha-1'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('integracaoPlanilhaGoogle — sem autorização', () => {
  it('sem accessToken devolve todos sem cotação, sem nenhuma chamada de rede', async () => {
    tokenSalvo = null
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const resultado = await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4', 'VALE3'], {
      tokens: {},
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado.semCotacao).toEqual(['PETR4', 'VALE3'])
    expect(resultado.cotacoes.size).toBe(0)
    expect(resultado.consultouRede).toBe(false)
    expect(estadoPlanilhaGoogle()).toEqual({ estado: 'nao-autorizada', motivo: null })
  })

  it('token sem o escopo da Sheets API também não faz chamada de rede', async () => {
    tokenSalvo = {
      accessToken: TOKEN,
      scope: 'https://www.googleapis.com/auth/drive.file',
      expiresAt: Date.now() + 3_600_000,
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const resultado = await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4'], {
      tokens: {},
      accessToken: TOKEN,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado.semCotacao).toEqual(['PETR4'])
    expect(estadoPlanilhaGoogle().estado).toBe('nao-autorizada')
  })
})

describe('integracaoPlanilhaGoogle — indisponível', () => {
  it('403 memoriza o estado e não repete a chamada na sessão', async () => {
    const fetchSpy = stubFetch(() => recusar(403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'))

    const primeiro = await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4'], {
      tokens: {},
      accessToken: TOKEN,
    })

    expect(primeiro.semCotacao).toEqual(['PETR4'])
    expect(estadoPlanilhaGoogle().estado).toBe('indisponivel')
    expect(estadoPlanilhaGoogle().motivo).toContain('permissão')

    const chamadas = fetchSpy.mock.calls.length
    const segundo = await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4'], {
      tokens: {},
      accessToken: TOKEN,
    })

    expect(segundo.semCotacao).toEqual(['PETR4'])
    expect(fetchSpy.mock.calls.length).toBe(chamadas)
  })

  it('erro de rede vira indisponível sem lançar', async () => {
    stubFetch(() => {
      throw new Error('offline')
    })

    const resultado = await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4'], {
      tokens: {},
      accessToken: TOKEN,
    })

    expect(resultado.semCotacao).toEqual(['PETR4'])
    expect(estadoPlanilhaGoogle().estado).toBe('indisponivel')
  })
})

describe('integracaoPlanilhaGoogle — ativa', () => {
  it('lê os preços da planilha em centavos e guarda o cache do dia', async () => {
    stubSheets([
      ['PETR4', 38.5, 38, 1.31],
      ['VALE3', '#N/A', '', ''],
    ])
    const consultados: string[] = []

    const resultado = await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4', 'VALE3'], {
      tokens: {},
      accessToken: TOKEN,
      aoConsultar: (descricao) => consultados.push(descricao),
    })

    expect(resultado.cotacoes.get('PETR4')).toMatchObject({
      preco: 3850,
      precoAbertura: 3800,
      fonte: 'api',
    })
    expect(resultado.cotacoes.get('PETR4')?.atualizadoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(resultado.semCotacao).toEqual(['VALE3'])
    expect(resultado.consultouRede).toBe(true)
    expect(consultados).toEqual(['planilha PETR4'])
    expect(estadoPlanilhaGoogle()).toEqual({ estado: 'ativa', motivo: null })
    expect(lerCotacaoPlanilhaCache('PETR4')).toMatchObject({ preco: 3850, fonte: 'cache' })
  })

  it('a cadeia cai para a próxima integração apenas com o que faltou', async () => {
    stubSheets([
      ['PETR4', 38.5, 38, 1.31],
      ['VALE3', '#N/A', '', ''],
    ])
    const recebidos: string[][] = []
    const seguinte: IntegracaoCotacao = {
      id: 'fake',
      nome: 'Fake',
      site: 'https://fake.test',
      exigeToken: false,
      b3: {
        lerCache: () => null,
        async atualizar(tickers) {
          recebidos.push([...tickers])
          return {
            cotacoes: new Map(
              tickers.map((ticker) => [
                ticker,
                { preco: 6000, precoAbertura: null, atualizadoEm: null, fonte: 'api' as const },
              ]),
            ),
            semCotacao: [],
            semToken: false,
            consultouRede: true,
          }
        },
      },
      limparCache() {},
    }

    const resultado = await cadeiaCotacoesB3([integracaoPlanilhaGoogle, seguinte]).atualizar(
      ['PETR4', 'VALE3'],
      { tokens: {}, accessToken: TOKEN },
    )

    expect(recebidos).toEqual([['VALE3']])
    expect(resultado.cotacoes.get('PETR4')?.preco).toBe(3850)
    expect(resultado.cotacoes.get('VALE3')?.preco).toBe(6000)
    expect(resultado.semCotacao).toEqual([])
  })
})

describe('limparCache da planilha', () => {
  it('apaga o cache do dia', async () => {
    stubSheets([['PETR4', 38.5, 38, 1.31]])
    await integracaoPlanilhaGoogle.b3!.atualizar(['PETR4'], { tokens: {}, accessToken: TOKEN })
    expect(lerCotacaoPlanilhaCache('PETR4')).not.toBeNull()

    integracaoPlanilhaGoogle.limparCache()

    expect(lerCotacaoPlanilhaCache('PETR4')).toBeNull()
  })
})
