import { isRendaFixa, isTesouroDireto, usaGoogFinance } from '@/lib/categoria'
import type { CategoriaAtivo, Operacao } from '@/types/domain'

/**
 * Resolução de **cotações** por ativo (RF10, RF19, RNF04).
 *
 * Módulo **puro**: recebe os possíveis preços de cada ativo e decide qual usar,
 * rotulando a **fonte** e o **status**. Isso permite à UI exibir
 * "cotação indisponível" sem travar nem quebrar o dashboard (RNF04).
 *
 * Ordem de preferência:
 * - Ação/FII/BDR: `GOOGLEFINANCE` (preço de mercado). Sem valor → indisponível.
 * - Tesouro Direto: API de dados abertos → marcação manual → indisponível.
 * - Renda Fixa: marcação a mercado manual → estimativa → indisponível.
 */

/** Fonte do preço atual de um ativo. */
export type FonteCotacao = 'googlefinance' | 'tesouro' | 'manual' | 'estimada'

/** Estado da cotação exibido na UI. */
export type StatusCotacao = 'disponivel' | 'manual' | 'estimada' | 'indisponivel'

/** Entrada para resolver a cotação de um ativo. */
export interface EntradaCotacao {
  ticker: string
  categoria: CategoriaAtivo
  /** Preço médio em **centavos** (fallback quando não há cotação). */
  precoMedio: number
  /** Preço de mercado em **centavos** (GOOGLEFINANCE ou API TD); `null` se ausente. */
  precoMercado: number | null
  /** Marcação a mercado manual em **centavos** (`Valor Bruto Atual`); `null` se ausente. */
  precoManual: number | null
  /** ISO do momento da última atualização conhecida. */
  atualizadoEm?: string | null
}

/** Cotação resolvida de um ativo. */
export interface CotacaoResolvida {
  ticker: string
  categoria: CategoriaAtivo
  /** Preço atual usado nos cálculos, em **centavos**. */
  precoAtual: number
  fonte: FonteCotacao
  status: StatusCotacao
  /** `true` quando não há cotação e o preço médio foi usado como fallback. */
  usandoFallback: boolean
  atualizadoEm: string | null
}

/** `true` para preços válidos e positivos. */
function precoValido(preco: number | null | undefined): preco is number {
  return typeof preco === 'number' && Number.isFinite(preco) && preco > 0
}

/** Status exibível (pt-BR) para exibição/tooltip. */
export const STATUS_COTACAO_LABELS: Record<StatusCotacao, string> = {
  disponivel: 'Disponível',
  manual: 'Manual',
  estimada: 'Estimada',
  indisponivel: 'Indisponível',
}

/** Resolve a cotação de um ativo conforme a categoria e os preços disponíveis. */
export function resolverCotacao(entrada: EntradaCotacao): CotacaoResolvida {
  const { ticker, categoria, precoMedio, precoManual, atualizadoEm = null } = entrada
  const mercado = entrada.precoMercado

  if (usaGoogFinance(categoria)) {
    if (precoValido(mercado)) {
      return {
        ticker,
        categoria,
        precoAtual: mercado,
        fonte: 'googlefinance',
        status: 'disponivel',
        usandoFallback: false,
        atualizadoEm,
      }
    }
  } else if (isTesouroDireto(categoria)) {
    if (precoValido(mercado)) {
      return {
        ticker,
        categoria,
        precoAtual: mercado,
        fonte: 'tesouro',
        status: 'disponivel',
        usandoFallback: false,
        atualizadoEm,
      }
    }
    if (precoValido(precoManual)) {
      return {
        ticker,
        categoria,
        precoAtual: precoManual,
        fonte: 'manual',
        status: 'manual',
        usandoFallback: false,
        atualizadoEm,
      }
    }
  } else if (isRendaFixa(categoria)) {
    if (precoValido(precoManual)) {
      return {
        ticker,
        categoria,
        precoAtual: precoManual,
        fonte: 'manual',
        status: 'manual',
        usandoFallback: false,
        atualizadoEm,
      }
    }
    if (precoValido(mercado)) {
      return {
        ticker,
        categoria,
        precoAtual: mercado,
        fonte: 'estimada',
        status: 'estimada',
        usandoFallback: false,
        atualizadoEm,
      }
    }
  }

  // Sem cotação: usa o preço médio como fallback (lucro 0) sem travar a UI (RNF04).
  return {
    ticker,
    categoria,
    precoAtual: precoMedio,
    fonte: 'manual',
    status: 'indisponivel',
    usandoFallback: true,
    atualizadoEm,
  }
}

/** Resolve as cotações de uma lista de posições (mapa `ticker → cotação`). */
export function resolverCotacoes(
  entradas: readonly EntradaCotacao[],
): Map<string, CotacaoResolvida> {
  const mapa = new Map<string, CotacaoResolvida>()
  for (const entrada of entradas) {
    const ticker = entrada.ticker.trim()
    if (ticker.length === 0 || mapa.has(ticker)) continue
    mapa.set(ticker, resolverCotacao({ ...entrada, ticker }))
  }
  return mapa
}

/**
 * Converte as cotações resolvidas no mapa `ticker → preço (centavos)` usado
 * pelo consolidado. Apenas cotações reais entram (indisponíveis caem no preço
 * médio dentro de `aplicarPrecosAtuais`).
 */
export function precosDeCotacoes(
  cotacoes: ReadonlyMap<string, CotacaoResolvida>,
): Map<string, number> {
  const precos = new Map<string, number>()
  for (const cotacao of cotacoes.values()) {
    if (!cotacao.usandoFallback) precos.set(cotacao.ticker, cotacao.precoAtual)
  }
  return precos
}

/**
 * Extrai a marcação a mercado manual (`Valor Bruto Atual`) mais recente por
 * ticker, a partir das operações de Renda Fixa (RF19).
 */
export function precosManuaisDeOperacoes(
  operacoes: readonly Operacao[],
): Map<string, number> {
  const porTicker = new Map<string, { data: string; valor: number }>()
  for (const operacao of operacoes) {
    if (!isRendaFixa(operacao.categoria)) continue
    const valor = operacao.valorBrutoAtual
    if (!precoValido(valor)) continue
    const ticker = operacao.ticker.trim()
    if (ticker.length === 0) continue
    const atual = porTicker.get(ticker)
    if (!atual || operacao.data >= atual.data) {
      porTicker.set(ticker, { data: operacao.data, valor })
    }
  }
  const precos = new Map<string, number>()
  for (const [ticker, info] of porTicker) precos.set(ticker, info.valor)
  return precos
}

/** `true` quando pelo menos uma cotação está indisponível. */
export function temCotacaoIndisponivel(
  cotacoes: ReadonlyMap<string, CotacaoResolvida>,
): boolean {
  for (const cotacao of cotacoes.values()) {
    if (cotacao.usandoFallback) return true
  }
  return false
}
