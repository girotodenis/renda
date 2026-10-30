import { isTesouroDireto, permiteMarcacaoManual, usaGoogFinance } from '@/domain/categoria'
import type { CategoriaAtivo, Operacao } from '@/domain/entities'
import { round2 } from '@/domain/money'

/**
 * Resolução de **cotações** por ativo (RF10, RF19, RNF04).
 *
 * Módulo **puro**: recebe os possíveis preços de cada ativo e decide qual usar,
 * rotulando a **fonte** e o **status**. Isso permite à UI exibir
 * "cotação indisponível" sem travar nem quebrar o dashboard (RNF04).
 *
 * Ordem de preferência:
 * - Ação/FII/BDR/ETF: `GOOGLEFINANCE` (planilha) → Brapi (fallback) → preço médio.
 * - Tesouro Direto: Brapi (preço de resgate) → marcação manual → estimativa → indisponível.
 * - Renda Fixa: marcação manual → estimativa → indisponível.
 */

/** Fonte do preço atual de um ativo. */
export type FonteCotacao = 'googlefinance' | 'brapi' | 'manual' | 'estimada'

/** Estado da cotação exibido na UI. */
export type StatusCotacao = 'disponivel' | 'manual' | 'estimada' | 'indisponivel'

/** Entrada para resolver a cotação de um ativo. */
export interface EntradaCotacao {
  ticker: string
  categoria: CategoriaAtivo
  /** Preço médio em **centavos** (fallback quando não há cotação). */
  precoMedio: number
  /** Preço de mercado em **centavos** (GOOGLEFINANCE ou último preço conhecido); `null` se ausente. */
  precoMercado: number | null
  /** Preço de abertura do dia em **centavos**; `null` se ausente (mesma fonte de `precoMercado`). */
  precoAbertura?: number | null
  /**
   * Preço de mercado em **centavos** (Brapi); `null` se ausente. Fallback do
   * GOOGLEFINANCE na B3; no Tesouro Direto, prioridade sobre a marcação manual.
   */
  precoBrapi?: number | null
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
  /** Preço de abertura do dia em **centavos**; `null` quando indisponível. */
  precoAbertura: number | null
  /** Variação do dia (%) entre `precoAtual` e `precoAbertura`; `null` quando indisponível. */
  variacaoDiaPercent: number | null
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

/**
 * Calcula a variação do dia (%) entre o preço atual e a abertura.
 * Retorna `null` quando algum preço é inválido ou a abertura é zero — evitando
 * divisão por zero e o falso preço (~R$ 0,11) de ticker não encontrado.
 */
export function calcularVariacaoDiaPercent(
  precoAtual: number | null | undefined,
  precoAbertura: number | null | undefined,
): number | null {
  if (!precoValido(precoAtual) || !precoValido(precoAbertura)) return null
  return round2(((precoAtual - precoAbertura) / precoAbertura) * 100)
}

/**
 * Abaixo disso (em centavos), a cotação do `GOOGLEFINANCE` é tratada como erro:
 * quando o ticker não é encontrado, o GOOGLEFINANCE devolve valores ~R$ 0,11.
 */
export const PRECO_MINIMO_GOOGLEFINANCE = 20

/**
 * `true` para preço de mercado válido conforme a categoria: Ação/FII/BDR/ETF
 * rejeitam cotações do `GOOGLEFINANCE` abaixo de `PRECO_MINIMO_GOOGLEFINANCE`
 * (acionando o fallback Brapi).
 */
export function precoMercadoValido(
  preco: number | null | undefined,
  categoria: CategoriaAtivo,
): preco is number {
  if (!precoValido(preco)) return false
  if (usaGoogFinance(categoria) && preco < PRECO_MINIMO_GOOGLEFINANCE) return false
  return true
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
  const {
    ticker,
    categoria,
    precoMedio,
    precoManual,
    precoBrapi = null,
    precoAbertura = null,
    atualizadoEm = null,
  } = entrada
  const mercado = entrada.precoMercado

  if (usaGoogFinance(categoria)) {
    if (precoMercadoValido(mercado, categoria)) {
      const abertura = precoMercadoValido(precoAbertura, categoria) ? precoAbertura : null
      return {
        ticker,
        categoria,
        precoAtual: mercado,
        precoAbertura: abertura,
        variacaoDiaPercent: calcularVariacaoDiaPercent(mercado, abertura),
        fonte: 'googlefinance',
        status: 'disponivel',
        usandoFallback: false,
        atualizadoEm,
      }
    }
    if (precoValido(precoBrapi)) {
      // A Brapi devolve a abertura do dia na mesma resposta: com ela a coluna
      // "Variação Dia (%)" continua preenchida sem depender do `GOOGLEFINANCE`.
      const abertura = precoValido(precoAbertura) ? precoAbertura : null
      return {
        ticker,
        categoria,
        precoAtual: precoBrapi,
        precoAbertura: abertura,
        variacaoDiaPercent: calcularVariacaoDiaPercent(precoBrapi, abertura),
        fonte: 'brapi',
        status: 'disponivel',
        usandoFallback: false,
        atualizadoEm,
      }
    }
  } else if (permiteMarcacaoManual(categoria)) {
    // Tesouro Direto: o preço de resgate publicado pelo Tesouro (via Brapi)
    // tem prioridade; ele é persistido em `Valor Bruto Atual` e passa a valer
    // como marcação quando a integração estiver indisponível.
    if (isTesouroDireto(categoria) && precoValido(precoBrapi)) {
      return {
        ticker,
        categoria,
        precoAtual: precoBrapi,
        precoAbertura: null,
        variacaoDiaPercent: null,
        fonte: 'brapi',
        status: 'disponivel',
        usandoFallback: false,
        atualizadoEm,
      }
    }
    // Renda Fixa e Tesouro Direto são marcados manualmente (RF19): o valor
    // informado pelo usuário tem prioridade; na ausência, usamos o último
    // preço conhecido (planilha) como estimativa.
    if (precoValido(precoManual)) {
      return {
        ticker,
        categoria,
        precoAtual: precoManual,
        precoAbertura: null,
        variacaoDiaPercent: null,
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
        precoAbertura: null,
        variacaoDiaPercent: null,
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
    precoAbertura: null,
    variacaoDiaPercent: null,
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
 * ticker, a partir das operações de **Renda Fixa** e **Tesouro Direto** (RF19).
 *
 * O valor informado pelo usuário (via modal do ativo ou formulário de operação)
 * é a fonte usada sempre que a integração não retornar cotação — e nunca é
 * apagado por falhas de integração.
 */
/** Extrai o `Valor Bruto Atual` mais recente por ticker, filtrando pelas categorias aceitas. */
function precosBrutosMaisRecentes(
  operacoes: readonly Operacao[],
  aceitar: (operacao: Operacao) => boolean,
): Map<string, number> {
  const porTicker = new Map<string, { data: string; valor: number }>()
  for (const operacao of operacoes) {
    if (!aceitar(operacao)) continue
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

export function precosManuaisDeOperacoes(
  operacoes: readonly Operacao[],
): Map<string, number> {
  return precosBrutosMaisRecentes(operacoes, (operacao) =>
    permiteMarcacaoManual(operacao.categoria),
  )
}

/**
 * Extrai o preço **persistido** por ticker B3 (Ação/FII/BDR/ETF), gravado em
 * `Valor Bruto Atual` da operação mais recente via Brapi. Usado para gravar o
 * fallback na planilha quando o `GOOGLEFINANCE` não trouxe preço (RNF04).
 */
export function precosPersistidosDeOperacoes(
  operacoes: readonly Operacao[],
): Map<string, number> {
  return precosBrutosMaisRecentes(operacoes, (operacao) =>
    usaGoogFinance(operacao.categoria),
  )
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
