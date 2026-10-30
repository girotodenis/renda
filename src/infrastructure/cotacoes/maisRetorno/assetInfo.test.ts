import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  atualizarSetoresMaisRetorno,
  clearMaisRetornoSetorCache,
  extrairSetor,
  lerSetorCache,
} from '@/infrastructure/cotacoes/maisRetorno/assetInfo'

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

describe('extrairSetor (/asset-info da Mais Retorno)', () => {
  it('lê `sector` na raiz', () => {
    expect(extrairSetor({ sector: 'Energia' })).toBe('Energia')
  })

  it('lê a chave em português (`setor`)', () => {
    expect(extrairSetor({ setor: 'Materiais Básicos' })).toBe('Materiais Básicos')
  })

  it('aceita o setor aninhado em `data`', () => {
    expect(extrairSetor({ data: { sector: 'Saúde' } })).toBe('Saúde')
  })

  it('aceita setor como objeto com `name`', () => {
    expect(extrairSetor({ sector: { name: 'Financeiro' } })).toBe('Financeiro')
  })

  it('cai para segmento/indústria quando não há setor', () => {
    expect(extrairSetor({ segment: 'Exploração e Produção' })).toBe('Exploração e Produção')
    expect(extrairSetor({ industry: 'Siderurgia' })).toBe('Siderurgia')
  })

  it('prefere o setor ao segmento', () => {
    expect(extrairSetor({ sector: 'Energia', segment: 'Petróleo' })).toBe('Energia')
  })

  it('retorna null quando nenhum campo conhecido traz texto', () => {
    expect(extrairSetor({ cnpj: '33041260065290' })).toBeNull()
    expect(extrairSetor({ sector: '   ' })).toBeNull()
    expect(extrairSetor({ error: true })).toBeNull()
    expect(extrairSetor(null)).toBeNull()
  })
})

describe('atualizarSetoresMaisRetorno', () => {
  it('sem api-key não toca a rede', async () => {
    const fetchSpy = stubFetch(() => ok({ sector: 'Energia' }))

    const resultado = await atualizarSetoresMaisRetorno(['PETR4'], { tokens: {} })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({
      semSetor: ['PETR4'],
      semToken: true,
      consultouRede: false,
    })
  })

  it('consulta /asset-info com X-Api-Key e devolve o setor', async () => {
    const fetchSpy = stubFetch(() => ok({ sector: 'Energia' }))

    const resultado = await atualizarSetoresMaisRetorno(['PETR4'], {
      tokens: { maisretorno: ' mr_abc ' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toContain('https://data.maisretorno.com/mr-data/v4/api/asset-info/petr4%3Ab3')
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('mr_abc')
    expect(resultado.setores.get('PETR4')).toBe('Energia')
    expect(resultado).toMatchObject({ semSetor: [], semToken: false, consultouRede: true })
  })

  it('usa o cache nas chamadas seguintes (1 crédito por ticker)', async () => {
    const fetchSpy = stubFetch(() => ok({ sector: 'Energia' }))
    await atualizarSetoresMaisRetorno(['PETR4'], { tokens: { maisretorno: 'mr_abc' } })

    const segunda = await atualizarSetoresMaisRetorno(['PETR4'], {
      tokens: { maisretorno: 'mr_abc' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(segunda.setores.get('PETR4')).toBe('Energia')
    expect(segunda.consultouRede).toBe(false)
  })

  it('falha HTTP deixa o ticker sem setor (sem lançar)', async () => {
    stubFetch(() => falha)

    const resultado = await atualizarSetoresMaisRetorno(['PETR4'], {
      tokens: { maisretorno: 'mr_abc' },
    })

    expect(resultado.setores.size).toBe(0)
    expect(resultado.semSetor).toEqual(['PETR4'])
  })

  it('limpa o cache local', async () => {
    stubFetch(() => ok({ sector: 'Energia' }))
    await atualizarSetoresMaisRetorno(['PETR4'], { tokens: { maisretorno: 'mr_abc' } })
    expect(lerSetorCache('PETR4')).toBe('Energia')

    clearMaisRetornoSetorCache()

    expect(lerSetorCache('PETR4')).toBeNull()
  })
})
