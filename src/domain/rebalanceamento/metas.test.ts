import { describe, expect, it } from 'vitest'
import { converterNotasEmMetas, normalizarMetas } from '@/domain/rebalanceamento/metas'
import type { MetaInput } from '@/domain/rebalanceamento/types'
import { CategoriaAtivo } from '@/domain/entities'

/**
 * Testes das Seções 5.2 (nota → meta) e 5.7 (classe vs. ticker).
 * Convenção: percentuais em 0–100.
 */

function soma(metas: Record<string, number>): number {
  return Object.values(metas).reduce((acc, valor) => acc + valor, 0)
}

describe('converterNotasEmMetas (Seção 5.2)', () => {
  it('converte notas proporcionais em metas percentuais', () => {
    const metas = converterNotasEmMetas([
      { ticker: 'PETR4', nota: 8 },
      { ticker: 'VALE3', nota: 2 },
    ])

    expect(metas).toEqual({ PETR4: 80, VALE3: 20 })
  })

  it('distribui igualmente quando a soma das notas é zero', () => {
    const metas = converterNotasEmMetas([
      { ticker: 'A', nota: 0 },
      { ticker: 'B', nota: 0 },
      { ticker: 'C', nota: 0 },
    ])

    expect(metas).toEqual({ A: 33.34, B: 33.33, C: 33.33 })
    expect(soma(metas)).toBe(100)
  })

  it('soma exatamente 100% mesmo com arredondamentos (notas iguais)', () => {
    const metas = converterNotasEmMetas([
      { ticker: 'A', nota: 7 },
      { ticker: 'B', nota: 7 },
      { ticker: 'C', nota: 7 },
      { ticker: 'D', nota: 7 },
    ])

    expect(soma(metas)).toBe(100)
  })

  it('ignora tickers vazios e notas negativas', () => {
    const metas = converterNotasEmMetas([
      { ticker: '  ', nota: 5 },
      { ticker: 'PETR4', nota: -3 },
      { ticker: 'VALE3', nota: 10 },
    ])

    expect(metas).toEqual({ PETR4: 0, VALE3: 100 })
  })
})

describe('normalizarMetas (Seção 5.7)', () => {
  it('rateia a meta da classe proporcionalmente às notas', () => {
    const itens: MetaInput[] = [
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, nota: 3, metaClasse: 100 },
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, nota: 1, metaClasse: 100 },
    ]

    expect(normalizarMetas(itens)).toEqual({ PETR4: 75, VALE3: 25 })
  })

  it('distribui igualmente dentro da classe quando não há notas', () => {
    const itens: MetaInput[] = [
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, nota: 0, metaClasse: 60 },
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, nota: 0, metaClasse: 60 },
      { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, nota: 0, metaClasse: 40 },
    ]

    const metas = normalizarMetas(itens)
    expect(metas).toEqual({ PETR4: 30, VALE3: 30, MXRF11: 40 })
  })

  it('prioriza a meta individual (ticker) sobre a da classe', () => {
    const itens: MetaInput[] = [
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, nota: 0, metaClasse: 60, metaIndividual: 30 },
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, nota: 1, metaClasse: 60 },
      { ticker: 'ITSA4', categoria: CategoriaAtivo.Acao, nota: 1, metaClasse: 60 },
      { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, nota: 5, metaClasse: 40 },
    ]

    const metas = normalizarMetas(itens)
    // Ação: 30 (PETR4) + rateio de 30 entre VALE3/ITSA4 = 15/15.
    expect(metas).toEqual({ PETR4: 30, VALE3: 15, ITSA4: 15, MXRF11: 40 })
    expect(soma(metas)).toBe(100)
  })

  it('normaliza para 100% quando as metas de classe não somam 100', () => {
    const itens: MetaInput[] = [
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, nota: 0, metaClasse: 30 },
      { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, nota: 0, metaClasse: 30 },
    ]

    expect(normalizarMetas(itens)).toEqual({ PETR4: 50, MXRF11: 50 })
  })

  it('zera o rateio quando as metas individuais consomem todo o orçamento da classe', () => {
    const itens: MetaInput[] = [
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, nota: 0, metaClasse: 20, metaIndividual: 20 },
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, nota: 5, metaClasse: 20 },
    ]

    expect(normalizarMetas(itens)).toEqual({ PETR4: 100, VALE3: 0 })
  })

  it('retorna vazio sem itens válidos', () => {
    expect(normalizarMetas([])).toEqual({})
    expect(
      normalizarMetas([{ ticker: '  ', categoria: CategoriaAtivo.Acao, metaClasse: 100 }]),
    ).toEqual({})
  })
})
