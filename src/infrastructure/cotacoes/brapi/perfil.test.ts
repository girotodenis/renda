import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarSetoresBrapi,
  clearBrapiSetorCache,
  extrairSetores,
  lerSetorCache,
} from '@/infrastructure/cotacoes/brapi/perfil'

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

const resposta = {
  results: [
    {
      requestedSymbol: 'PETR4',
      symbol: 'PETR4',
      changed: false,
      data: { sector: 'Energia', sectorKey: 'energia', sectorDisp: 'Energia' },
    },
    { symbol: 'HGLG11', data: { sectorDisp: 'Logística' } },
    { symbol: 'SEMSETOR', data: { sector: null, sectorDisp: '' } },
  ],
}

/** Resposta com um único perfil (formato de uma requisição por ticker). */
function respostaDe(setor: string): unknown {
  return { results: [{ symbol: 'PETR4', data: { sector: setor } }] }
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => impl(url, init))
  vi.stubGlobal('fetch', spy)
  return spy
}

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const falha = { ok: false, status: 403, json: async () => ({}) } as unknown as Response

beforeEach(() => {
  armazenamento.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extrairSetores (Brapi /stocks/profile)', () => {
  it('extrai ticker → setor, usando sectorDisp como fallback', () => {
    const setores = extrairSetores(resposta)
    expect(setores.get('PETR4')).toBe('Energia')
    expect(setores.get('HGLG11')).toBe('Logística')
  })

  it('ignora registros sem setor', () => {
    expect(extrairSetores(resposta).has('SEMSETOR')).toBe(false)
  })

  it('normaliza o ticker para maiúsculas', () => {
    expect(extrairSetores({ results: [{ symbol: 'petr4', data: { sector: 'Energia' } }] }).get('PETR4')).toBe(
      'Energia',
    )
  })

  it('retorna mapa vazio para payloads inesperados', () => {
    expect(extrairSetores(null).size).toBe(0)
    expect(extrairSetores({ results: 'nope' }).size).toBe(0)
    expect(extrairSetores({ error: true, results: [] }).size).toBe(0)
  })
})

describe('atualizarSetoresBrapi', () => {
  it('sem token não toca a rede e devolve os tickers sem setor', async () => {
    const fetchSpy = stubFetch(() => ok(respostaDe('Energia')))

    const resultado = await atualizarSetoresBrapi(['PETR4'], { tokens: {} })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({
      semSetor: ['PETR4'],
      semToken: true,
      consultouRede: false,
    })
  })

  it('consulta o perfil com Bearer e devolve o setor', async () => {
    const fetchSpy = stubFetch(() => ok(respostaDe('Energia')))

    const resultado = await atualizarSetoresBrapi([' petr4 '], { tokens: { brapi: ' token-abc ' } })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toContain('https://brapi.dev/api/v2/stocks/profile?symbols=PETR4')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-abc')
    expect(resultado.setores.get('PETR4')).toBe('Energia')
    expect(resultado).toMatchObject({ semSetor: [], semToken: false, consultouRede: true })
  })

  it('usa o cache nas chamadas seguintes', async () => {
    const fetchSpy = stubFetch(() => ok(respostaDe('Energia')))
    await atualizarSetoresBrapi(['PETR4'], { tokens: { brapi: 'token' } })

    const segunda = await atualizarSetoresBrapi(['PETR4'], { tokens: { brapi: 'token' } })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(segunda.setores.get('PETR4')).toBe('Energia')
    expect(segunda.consultouRede).toBe(false)
  })

  it('forceRefresh ignora o cache', async () => {
    const fetchSpy = stubFetch(() => ok(respostaDe('Energia')))
    await atualizarSetoresBrapi(['PETR4'], { tokens: { brapi: 'token' } })
    await atualizarSetoresBrapi(['PETR4'], { tokens: { brapi: 'token' }, forceRefresh: true })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('falha HTTP deixa o ticker sem setor (sem lançar)', async () => {
    stubFetch(() => falha)

    const resultado = await atualizarSetoresBrapi(['PETR4'], { tokens: { brapi: 'token' } })

    expect(resultado.setores.size).toBe(0)
    expect(resultado.semSetor).toEqual(['PETR4'])
  })

  it('limpa o cache local', async () => {
    stubFetch(() => ok(respostaDe('Energia')))
    await atualizarSetoresBrapi(['PETR4'], { tokens: { brapi: 'token' } })
    expect(lerSetorCache('PETR4')).toBe('Energia')

    clearBrapiSetorCache()

    expect(lerSetorCache('PETR4')).toBeNull()
  })
})
