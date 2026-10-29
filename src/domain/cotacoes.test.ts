import { describe, expect, it } from 'vitest'
import {
  calcularVariacaoDiaPercent,
  precosDeCotacoes,
  precosManuaisDeOperacoes,
  precosPersistidosDeOperacoes,
  precoMercadoValido,
  resolverCotacao,
  resolverCotacoes,
  temCotacaoIndisponivel,
} from '@/domain/cotacoes'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Operacao } from '@/domain/entities'

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

  it('usa o preço da Brapi como fallback quando o GOOGLEFINANCE falha', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: null,
      precoBrapi: 2500,
    })
    expect(cotacao).toMatchObject({
      precoAtual: 2500,
      fonte: 'brapi',
      status: 'disponivel',
      usandoFallback: false,
    })
  })

  it('prioriza o GOOGLEFINANCE sobre a Brapi', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 2600,
      precoBrapi: 2500,
    })
    expect(cotacao).toMatchObject({ precoAtual: 2600, fonte: 'googlefinance' })
  })

  it('trata cotação do GOOGLEFINANCE abaixo de R$ 0,20 como erro e usa a Brapi', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 11, // R$ 0,11 — ticker não encontrado no GOOGLEFINANCE
      precoBrapi: 2500,
    })
    expect(cotacao).toMatchObject({ precoAtual: 2500, fonte: 'brapi', usandoFallback: false })
  })

  it('aceita o GOOGLEFINANCE a partir de R$ 0,20', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 20,
    })
    expect(cotacao).toMatchObject({ precoAtual: 20, fonte: 'googlefinance' })
  })
})

describe('precoMercadoValido', () => {
  it('rejeita GOOGLEFINANCE abaixo de R$ 0,20, mas aceita outras categorias', () => {
    expect(precoMercadoValido(11, CategoriaAtivo.Acao)).toBe(false)
    expect(precoMercadoValido(20, CategoriaAtivo.Acao)).toBe(true)
    expect(precoMercadoValido(2500, CategoriaAtivo.Acao)).toBe(true)
    expect(precoMercadoValido(11, CategoriaAtivo.TesouroDireto)).toBe(true)
    expect(precoMercadoValido(null, CategoriaAtivo.Acao)).toBe(false)
  })
})

describe('calcularVariacaoDiaPercent', () => {
  it('calcula a variação entre o preço atual e a abertura', () => {
    expect(calcularVariacaoDiaPercent(1200, 1000)).toBe(20)
    expect(calcularVariacaoDiaPercent(900, 1000)).toBe(-10)
    expect(calcularVariacaoDiaPercent(1000, 1000)).toBe(0)
  })

  it('retorna null quando não há abertura válida (evita divisão por zero)', () => {
    expect(calcularVariacaoDiaPercent(1200, null)).toBeNull()
    expect(calcularVariacaoDiaPercent(1200, 0)).toBeNull()
    expect(calcularVariacaoDiaPercent(null, 1000)).toBeNull()
  })
})

describe('resolverCotacao — variação do dia', () => {
  it('usa a abertura do GOOGLEFINANCE no mesmo par do preço atual', () => {
    const cotacao = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 1200,
      precoAbertura: 1000,
    })
    expect(cotacao).toMatchObject({
      precoAtual: 1200,
      precoAbertura: 1000,
      variacaoDiaPercent: 20,
      fonte: 'googlefinance',
    })
  })

  it('não calcula variação sem abertura', () => {
    const semAbertura = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: 1200,
    })
    expect(semAbertura.precoAbertura).toBeNull()
    expect(semAbertura.variacaoDiaPercent).toBeNull()
  })

  it('usa a abertura da Brapi quando o preço vem do fallback', () => {
    const brapi = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: null,
      precoBrapi: 1200,
      precoAbertura: 1000,
    })
    expect(brapi.fonte).toBe('brapi')
    expect(brapi.precoAbertura).toBe(1000)
    expect(brapi.variacaoDiaPercent).toBe(20)
  })

  it('mantém a variação nula quando a Brapi não informa a abertura', () => {
    const brapi = resolverCotacao({
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      ...base,
      precoMercado: null,
      precoBrapi: 1200,
    })
    expect(brapi.fonte).toBe('brapi')
    expect(brapi.precoAbertura).toBeNull()
    expect(brapi.variacaoDiaPercent).toBeNull()
  })
})

describe('resolverCotacao — Tesouro Direto (marcação manual)', () => {
  it('usa a marcação manual quando informada', () => {
    const cotacao = resolverCotacao({
      ticker: 'TD-IPCA-2029',
      categoria: CategoriaAtivo.TesouroDireto,
      ...base,
      precoManual: 340000,
    })
    expect(cotacao).toMatchObject({ precoAtual: 340000, status: 'manual', fonte: 'manual' })
  })

  it('usa fallback (preço médio) sem preço manual', () => {
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

  it('pega o Valor Bruto Atual mais recente por ticker (Renda Fixa e Tesouro)', () => {
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
        ticker: 'Tesouro Selic 2029',
        data: '2026-03-01',
        categoria: CategoriaAtivo.TesouroDireto,
        valorBrutoAtual: 1520000,
      }),
      operacao({
        ticker: 'PETR4',
        data: '2026-06-01',
        categoria: CategoriaAtivo.Acao,
        valorBrutoAtual: 999999,
      }),
    ])
    expect(precos.get('CDB-BANCO')).toBe(108000)
    expect(precos.get('Tesouro Selic 2029')).toBe(1520000)
    expect(precos.has('PETR4')).toBe(false)
  })
})

describe('precosPersistidosDeOperacoes', () => {
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

  it('pega o Valor Bruto Atual mais recente por ticker B3 (fallback Brapi)', () => {
    const precos = precosPersistidosDeOperacoes([
      operacao({
        ticker: 'PETR4',
        data: '2026-01-01',
        categoria: CategoriaAtivo.Acao,
        valorBrutoAtual: 2500,
      }),
      operacao({
        ticker: 'PETR4',
        data: '2026-06-01',
        categoria: CategoriaAtivo.Acao,
        valorBrutoAtual: 2800,
      }),
      operacao({
        ticker: 'HGLG11',
        data: '2026-03-01',
        categoria: CategoriaAtivo.Fii,
        valorBrutoAtual: 15000,
      }),
      operacao({
        ticker: 'CDB-BANCO',
        data: '2026-06-01',
        categoria: CategoriaAtivo.RendaFixa,
        valorBrutoAtual: 999999,
      }),
    ])
    expect(precos.get('PETR4')).toBe(2800)
    expect(precos.get('HGLG11')).toBe(15000)
    expect(precos.has('CDB-BANCO')).toBe(false)
  })
})
