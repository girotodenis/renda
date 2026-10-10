import { describe, expect, it } from 'vitest'
import {
  precosDeCotacoes,
  precosManuaisDeOperacoes,
  resolverCotacao,
  resolverCotacoes,
  temCotacaoIndisponivel,
} from '@/lib/cotacoes'
import { CategoriaAtivo, OperacaoTipo } from '@/types/domain'
import type { Operacao } from '@/types/domain'

/** Testes da resolução de cotações (RF10, RF19, RNF04). */

const base = { precoMedio: 1000, precoMercado: null, precoManual: null } as const

describe('resolverCotacao — Ação/FII/BDR (GOOGLEFINANCE)', () => {
  it('usa o preço de mercado quando disponível', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 2500,
    })
    expect(cotacao).toMatchObject({
      precoAtual: 2500,
      fonte: 'googlefinance',
      status: 'disponivel',
      usandoFallback: false,
    })
  })

  it('cai no preço médio quando o GOOGLEFINANCE falha (RNF04)', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: null,
    })
    expect(cotacao).toMatchObject({
      precoAtual: 1000,
      status: 'indisponivel',
      usandoFallback: true,
    })
  })

  it('ignora preço inválido (0/negativo) e usa fallback', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 0,
    })
    expect(cotacao.usandoFallback).toBe(true)
  })
})

describe('resolverCotacao — Tesouro Direto (API/cache/manual)', () => {
  it('usa a cotação da API quando disponível', () => {
    const cotacao = resolverCotacao({
      ticker: 'TD-IPCA-2029',
      categoria: CategoriaAtivo.TesouroDireto,
      ...base,
      precoMercado: 350000,
      atualizadoEm: '2026-10-06',
    })
    expect(cotacao).toMatchObject({
      precoAtual: 350000,
      fonte: 'tesouro',
      status: 'disponivel',
      atualizadoEm: '2026-10-06',
    })
  })

  it('usa a marcação manual quando a API falha', () => {
    const cotacao = resolverCotacao({
      ticker: 'TD-IPCA-2029',
      categoria: CategoriaAtivo.TesouroDireto,
      ...base,
      precoManual: 340000,
    })
    expect(cotacao).toMatchObject({ precoAtual: 340000, status: 'manual', fonte: 'manual' })
  })

  it('usa fallback (preço médio) sem API e sem preço manual', () => {
    const cotacao = resolverCotacao({
      ticker: 'TD-IPCA-2029',
      categoria: CategoriaAtivo.TesouroDireto,
      ...base,
    })
    expect(cotacao).toMatchObject({ status: 'indisponivel', usandoFallback: true, precoAtual: 1000 })
  })
})

describe('resolverCotacao — Renda Fixa (marcação a mercado/estimativa)', () => {
  it('usa a marcação a mercado editável (Valor Bruto Atual)', () => {
    const cotacao = resolverCotacao({
      ticker: 'CDB-BANCO',
      categoria: CategoriaAtivo.RendaFixa,
      ...base,
      precoManual: 105000,
    })
    expect(cotacao).toMatchObject({ precoAtual: 105000, status: 'manual', fonte: 'manual' })
  })

  it('usa a estimativa quando disponível (Indexador + %)', () => {
    const cotacao = resolverCotacao({
      ticker: 'CDB-BANCO',
      categoria: CategoriaAtivo.RendaFixa,
      ...base,
      precoMercado: 102500,
    })
    expect(cotacao).toMatchObject({ precoAtual: 102500, status: 'estimada', fonte: 'estimada' })
  })

  it('entra em indisponível sem valor manual/estimado', () => {
    const cotacao = resolverCotacao({
      ticker: 'CDB-BANCO',
      categoria: CategoriaAtivo.RendaFixa,
      ...base,
    })
    expect(cotacao.status).toBe('indisponivel')
  })
})

describe('resolverCotacoes / precosDeCotacoes', () => {
  it('deduplica tickers e ignora vazios', () => {
    const mapa = resolverCotacoes([
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, ...base, precoMercado: 2500 },
      { ticker: '', categoria: CategoriaAtivo.Acao, ...base },
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, ...base, precoMercado: 9999 },
    ])
    expect(mapa.size).toBe(1)
    expect(mapa.get('PETR4')?.precoAtual).toBe(2500)
  })

  it('exclui cotações em fallback do mapa de preços', () => {
    const mapa = resolverCotacoes([
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, ...base, precoMercado: 2500 },
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, ...base },
    ])
    const precos = precosDeCotacoes(mapa)
    expect(precos.get('PETR4')).toBe(2500)
    expect(precos.has('VALE3')).toBe(false)
    expect(temCotacaoIndisponivel(mapa)).toBe(true)
  })
})

describe('precosManuaisDeOperacoes', () => {
  function operacao(partial: Partial<Operacao> & Pick<Operacao, 'ticker' | 'data' | 'categoria'>): Operacao {
    return {
      id: `op-${partial.ticker}-${partial.data}`,
      tipo: OperacaoTipo.Compra,
      quantidade: 1,
      precoUnitario: 1000,
      taxas: 0,
      indexador: null,
      percentualIndexador: null,
      vencimento: null,
      valorBrutoAtual: null,
      ...partial,
    }
  }

  it('pega o Valor Bruto Atual mais recente por ticker de Renda Fixa', () => {
    const precos = precosManuaisDeOperacoes([
      operacao({
        ticker: 'CDB-BANCO',
        data: '2026-01-01',
        categoria: CategoriaAtivo.RendaFixa,
        valorBrutoAtual: 100000,
      }),
      operacao({
        ticker: 'CDB-BANCO',
        data: '2026-06-01',
        categoria: CategoriaAtivo.RendaFixa,
        valorBrutoAtual: 108000,
      }),
      operacao({
        ticker: 'PETR4',
        data: '2026-06-01',
        categoria: CategoriaAtivo.Acao,
        valorBrutoAtual: 999999,
      }),
    ])
    expect(precos.get('CDB-BANCO')).toBe(108000)
    expect(precos.has('PETR4')).toBe(false)
  })
})
