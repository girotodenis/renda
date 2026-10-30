import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  integracoesCotacao,
  provedorCotacoesB3,
  provedorCotacoesTesouro,
  provedorListaTickers,
} from '@/infrastructure/cotacoes/registro'
import { chaveToken } from '@/domain/configuracoes'

const armazenamento = new Map<string, string>()

vi.mock('@/infrastructure/storage', () => ({
  readStorageJson: (chave: string) => {
    const valor = armazenamento.get(chave)
    return valor === undefined ? null : JSON.parse(valor)
  },
  writeStorageJson: (chave: string, valor: unknown) => {
    armazenamento.set(chave, JSON.stringify(valor))
  },
  clearStorageKeys: (prefixo: string) => {
    for (const chave of [...armazenamento.keys()]) {
      if (chave.startsWith(prefixo)) armazenamento.delete(chave)
    }
  },
}))

const TOKENS = { brapi: 'token-brapi', maisretorno: 'mr_abc' }

describe('registro de integrações de cotação', () => {
  it('ordena as integrações por prioridade (Brapi → Mais Retorno)', () => {
    expect(integracoesCotacao.map(({ id, nome }) => [id, nome])).toEqual([
      ['brapi', 'Brapi'],
      ['maisretorno', 'Mais Retorno'],
    ])
  })

  it('cada integração tem id único, site e a chave de token correspondente', () => {
    const ids = integracoesCotacao.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const integracao of integracoesCotacao) {
      expect(integracao.site.startsWith('https://')).toBe(true)
      expect(chaveToken(integracao.id)).toMatch(/^[a-z]+_token$/)
      expect(integracao.exigeToken).toBe(true)
      expect(typeof integracao.limparCache).toBe('function')
    }
  })

  it('expõe as cadeias compostas das capacidades disponíveis', () => {
    expect(provedorCotacoesB3.atualizar).toBeTypeOf('function')
    expect(provedorCotacoesB3.lerCache).toBeTypeOf('function')
    expect(provedorCotacoesTesouro.atualizar).toBeTypeOf('function')
    expect(provedorCotacoesTesouro.lerCache).toBeTypeOf('function')
    expect(provedorListaTickers.listar).toBeTypeOf('function')
  })
})

describe('cadeia real de cotação (Brapi → Mais Retorno)', () => {
  beforeEach(() => {
    armazenamento.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cai para a Mais Retorno quando a Brapi não devolve a cotação', async () => {
    const chamadas: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        chamadas.push(url)
        if (url.includes('brapi.dev')) {
          return { ok: false, status: 401, json: async () => ({}) } as unknown as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ quotes: [{ d: '2026-10-28', c: 52.2 }] }),
        } as unknown as Response
      }),
    )

    const resultado = await provedorCotacoesB3.atualizar(['PETR4'], { tokens: TOKENS })

    expect(chamadas.some((url) => url.includes('brapi.dev'))).toBe(true)
    expect(chamadas.some((url) => url.includes('data.maisretorno.com'))).toBe(true)
    expect(resultado.cotacoes.get('PETR4')).toMatchObject({ preco: 5220 })
    expect(resultado.semCotacao).toEqual([])
    expect(resultado.semToken).toBe(false)
  })

  it('não consulta a Mais Retorno quando a Brapi já cotou o ativo', async () => {
    const chamadas: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        chamadas.push(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ symbol: 'PETR4', regularMarketPrice: 60, regularMarketOpen: 59 }],
          }),
        } as unknown as Response
      }),
    )

    const resultado = await provedorCotacoesB3.atualizar(['PETR4'], { tokens: TOKENS })

    expect(chamadas.some((url) => url.includes('data.maisretorno.com'))).toBe(false)
    expect(resultado.cotacoes.get('PETR4')).toMatchObject({ preco: 6000, precoAbertura: 5900 })
  })

  it('com apenas o token da Mais Retorno, a Brapi é pulada e o diagnóstico não indica semToken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ quotes: [{ d: '2026-10-28', c: 10 }] }),
      })) as unknown as typeof fetch,
    )

    const resultado = await provedorCotacoesB3.atualizar(['VALE3'], {
      tokens: { maisretorno: 'mr_abc' },
    })

    expect(resultado.cotacoes.get('VALE3')).toMatchObject({ preco: 1000 })
    expect(resultado.semToken).toBe(false)
  })
})
