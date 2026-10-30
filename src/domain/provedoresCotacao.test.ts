import { describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo } from '@/domain/entities'
import {
  cadeiaCotacoesB3,
  cadeiaCotacoesTesouro,
  cadeiaListaTickers,
} from '@/domain/provedoresCotacao'
import type {
  CotacaoMercado,
  IntegracaoCotacao,
  ResultadoCotacoes,
} from '@/domain/provedoresCotacao'

function cotacao(preco: number): CotacaoMercado {
  return { preco, precoAbertura: null, atualizadoEm: null, fonte: 'api' }
}

function resultado(
  cotacoes: [string, number][],
  semCotacao: string[],
  extra: Partial<ResultadoCotacoes> = {},
): ResultadoCotacoes {
  return {
    cotacoes: new Map(cotacoes.map(([ticker, preco]) => [ticker, cotacao(preco)])),
    semCotacao,
    semToken: false,
    consultouRede: true,
    ...extra,
  }
}

function integracao(id: string, parcial: Partial<IntegracaoCotacao> = {}): IntegracaoCotacao {
  return { id, nome: id, site: `https://${id}.dev`, exigeToken: true, limparCache: vi.fn(), ...parcial }
}

const opcoes = { tokens: { a: 'ta', b: 'tb' } }

describe('cadeiaCotacoesB3', () => {
  it('consulta o próximo provedor só com os tickers que faltaram', async () => {
    const atualizarA = vi.fn().mockResolvedValue(resultado([['PETR4', 100]], ['VALE3', 'ITSA4']))
    const atualizarB = vi.fn().mockResolvedValue(resultado([['VALE3', 200]], ['ITSA4']))
    const cadeia = cadeiaCotacoesB3([
      integracao('a', { b3: { atualizar: atualizarA, lerCache: () => null } }),
      integracao('b', { b3: { atualizar: atualizarB, lerCache: () => null } }),
    ])

    const total = await cadeia.atualizar(['PETR4', 'VALE3', 'ITSA4'], opcoes)

    expect(atualizarA).toHaveBeenCalledWith(['PETR4', 'VALE3', 'ITSA4'], opcoes)
    expect(atualizarB).toHaveBeenCalledWith(['VALE3', 'ITSA4'], opcoes)
    expect([...total.cotacoes.keys()]).toEqual(['PETR4', 'VALE3'])
    expect(total.semCotacao).toEqual(['ITSA4'])
    expect(total.consultouRede).toBe(true)
  })

  it('não chama provedores seguintes quando tudo foi cotado', async () => {
    const atualizarB = vi.fn()
    const cadeia = cadeiaCotacoesB3([
      integracao('a', {
        b3: { atualizar: vi.fn().mockResolvedValue(resultado([['PETR4', 100]], [])), lerCache: () => null },
      }),
      integracao('b', { b3: { atualizar: atualizarB, lerCache: () => null } }),
    ])

    await cadeia.atualizar(['PETR4'], opcoes)

    expect(atualizarB).not.toHaveBeenCalled()
  })

  it('só marca semToken quando nenhum provedor consultado tinha token', async () => {
    const semToken = { semToken: true, consultouRede: false }
    const cadeia = cadeiaCotacoesB3([
      integracao('a', {
        b3: { atualizar: vi.fn().mockResolvedValue(resultado([], ['PETR4'], semToken)), lerCache: () => null },
      }),
      integracao('b', {
        b3: { atualizar: vi.fn().mockResolvedValue(resultado([['PETR4', 1]], [])), lerCache: () => null },
      }),
    ])
    expect((await cadeia.atualizar(['PETR4'], opcoes)).semToken).toBe(false)

    const soSemToken = cadeiaCotacoesB3([
      integracao('a', {
        b3: { atualizar: vi.fn().mockResolvedValue(resultado([], ['PETR4'], semToken)), lerCache: () => null },
      }),
    ])
    expect((await soSemToken.atualizar(['PETR4'], opcoes)).semToken).toBe(true)
  })

  it('sem provedores B3, devolve todos os tickers sem cotação', async () => {
    const cadeia = cadeiaCotacoesB3([integracao('a')])
    expect(await cadeia.atualizar(['petr4', 'PETR4'], opcoes)).toMatchObject({
      semCotacao: ['PETR4'],
      consultouRede: false,
    })
  })

  it('lê o cache do primeiro provedor que tiver a cotação', () => {
    const cadeia = cadeiaCotacoesB3([
      integracao('a', { b3: { atualizar: vi.fn(), lerCache: () => null } }),
      integracao('b', { b3: { atualizar: vi.fn(), lerCache: () => cotacao(300) } }),
    ])
    expect(cadeia.lerCache('PETR4')?.preco).toBe(300)
  })
})

describe('cadeiaCotacoesTesouro', () => {
  it('encadeia os títulos pendentes preservando o vencimento', async () => {
    const titulos = [
      { ticker: 'Tesouro Selic 2029', vencimento: '2029-03-01' },
      { ticker: 'Tesouro IPCA+ 2035', vencimento: null },
    ]
    const atualizarB = vi.fn().mockResolvedValue(resultado([['Tesouro IPCA+ 2035', 2]], []))
    const cadeia = cadeiaCotacoesTesouro([
      integracao('a', {
        tesouro: {
          atualizar: vi.fn().mockResolvedValue(resultado([['Tesouro Selic 2029', 1]], ['Tesouro IPCA+ 2035'])),
          lerCache: () => new Map(),
        },
      }),
      integracao('b', { tesouro: { atualizar: atualizarB, lerCache: () => new Map() } }),
    ])

    const total = await cadeia.atualizar(titulos, opcoes)

    expect(atualizarB).toHaveBeenCalledWith([titulos[1]], opcoes)
    expect(total.cotacoes.size).toBe(2)
    expect(total.semCotacao).toEqual([])
  })

  it('não consulta nada sem títulos', async () => {
    const atualizar = vi.fn()
    const cadeia = cadeiaCotacoesTesouro([
      integracao('a', { tesouro: { atualizar, lerCache: () => new Map() } }),
    ])
    expect(await cadeia.atualizar([], opcoes)).toMatchObject({ semCotacao: [], semToken: false })
    expect(atualizar).not.toHaveBeenCalled()
  })
})

describe('cadeiaListaTickers', () => {
  it('usa a primeira integração que devolver tickers', async () => {
    const cadeia = cadeiaListaTickers([
      integracao('a', { tickers: { listar: vi.fn().mockResolvedValue([]) } }),
      integracao('b', { tickers: { listar: vi.fn().mockResolvedValue(['PETR4']) } }),
    ])
    expect(await cadeia.listar(CategoriaAtivo.Acao)).toEqual(['PETR4'])
  })
})
