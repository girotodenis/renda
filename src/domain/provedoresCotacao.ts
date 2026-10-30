import type { CategoriaAtivo } from '@/domain/entities'

/**
 * **Portas** das integrações de cotação (Ação/FII/BDR/ETF, Tesouro Direto e
 * lista de tickers para o autocomplete).
 *
 * O domínio e a aplicação dependem só destas interfaces; cada API externa
 * (Brapi, ...) é um **adaptador** em `infrastructure/cotacoes/<provedor>`,
 * registrado em `infrastructure/cotacoes/registro.ts`. Para incluir uma nova
 * API basta implementar as portas que ela suporta e registrá-la — nenhum outro
 * módulo precisa mudar (Open/Closed).
 *
 * Contrato comum: os adaptadores **nunca lançam** (RNF04). Falhas de rede,
 * token ausente ou formato inesperado resultam em "sem cotação".
 */

/** Cotação de mercado obtida de uma API externa. */
export interface CotacaoMercado {
  /** Preço unitário em **centavos**. */
  preco: number
  /** Preço de abertura do dia em **centavos** (`null` quando indisponível). */
  precoAbertura: number | null
  /** ISO (`YYYY-MM-DD`) da última atualização conhecida (`null` quando desconhecida). */
  atualizadoEm: string | null
  fonte: 'api' | 'cache'
}

/** Resultado detalhado de uma consulta (para avisos na UI). */
export interface ResultadoCotacoes {
  /** Cotações obtidas (cache ou API), por ticker. */
  cotacoes: Map<string, CotacaoMercado>
  /** Tickers consultados que ficaram sem cotação. */
  semCotacao: string[]
  /** `true` quando o provedor exige token e nenhum foi configurado. */
  semToken: boolean
  /** `true` quando houve pelo menos uma requisição à API. */
  consultouRede: boolean
}

/** Tokens configurados pelo usuário, por `id` do provedor. */
export type TokensProvedores = Readonly<Record<string, string>>

/** Opções de uma consulta de cotações. */
export interface OpcoesConsultaCotacoes {
  tokens: TokensProvedores
  /** Ignora o cache local e consulta a API (atualização manual). */
  forceRefresh?: boolean
}

/** Título do Tesouro da carteira a cotar (ticker + vencimento da operação). */
export interface TituloTesouroCarteira {
  ticker: string
  /** Vencimento ISO registrado nas operações (`null` quando ausente). */
  vencimento: string | null
}

/** Cotações de B3 (Ação/FII/BDR/ETF) — fallback do `GOOGLEFINANCE`. */
export interface ProvedorCotacoesB3 {
  /** Cotação do cache local ainda válida (modo offline). */
  lerCache(ticker: string): CotacaoMercado | null
  atualizar(tickers: readonly string[], opcoes: OpcoesConsultaCotacoes): Promise<ResultadoCotacoes>
}

/** Preços de resgate do Tesouro Direto. */
export interface ProvedorCotacoesTesouro {
  /** Cotações do cache local ainda válido (modo offline). */
  lerCache(titulos: readonly TituloTesouroCarteira[]): Map<string, CotacaoMercado>
  atualizar(
    titulos: readonly TituloTesouroCarteira[],
    opcoes: OpcoesConsultaCotacoes,
  ): Promise<ResultadoCotacoes>
}

/** Lista de tickers negociados (autocomplete do cadastro). */
export interface ProvedorListaTickers {
  /** Tickers da categoria; `[]` quando não suportada ou indisponível. */
  listar(categoria: CategoriaAtivo): Promise<string[]>
}

/**
 * Uma integração de cotações (uma API externa) e as capacidades que ela
 * oferece. Capacidades ausentes simplesmente não participam da cadeia.
 */
export interface IntegracaoCotacao {
  /** Identificador estável; também define a chave do token (`<id>_token`). */
  id: string
  /** Nome exibido ao usuário (`Brapi`). */
  nome: string
  /** Site onde o usuário obtém o token. */
  site: string
  /** `true` quando a integração precisa de token para cotar. */
  exigeToken: boolean
  /** Dica exibida quando títulos do Tesouro ficam sem cotação (ex.: plano pago). */
  dicaTesouroSemCotacao?: string
  b3?: ProvedorCotacoesB3
  tesouro?: ProvedorCotacoesTesouro
  tickers?: ProvedorListaTickers
  /** Remove os caches locais (ex.: após trocar o token). */
  limparCache(): void
}

function resultadoVazio(): ResultadoCotacoes {
  return { cotacoes: new Map(), semCotacao: [], semToken: false, consultouRede: false }
}

/**
 * Consulta os provedores **em ordem de prioridade**: cada um recebe apenas o
 * que os anteriores não conseguiram cotar. `semToken` só é `true` quando
 * nenhum provedor que exigia token estava configurado.
 */
async function consultarEmCadeia<T>(
  provedores: readonly ((itens: readonly T[]) => Promise<ResultadoCotacoes>)[],
  itens: readonly T[],
  chave: (item: T) => string,
): Promise<ResultadoCotacoes> {
  if (provedores.length === 0) {
    return { ...resultadoVazio(), semCotacao: [...new Set(itens.map(chave))] }
  }
  const total = resultadoVazio()
  let pendentes = itens
  let todosSemToken = true
  for (const consultar of provedores) {
    if (pendentes.length === 0) break
    const resultado = await consultar(pendentes)
    for (const [ticker, cotacao] of resultado.cotacoes) total.cotacoes.set(ticker, cotacao)
    total.consultouRede ||= resultado.consultouRede
    todosSemToken &&= resultado.semToken
    const faltando = new Set(resultado.semCotacao)
    pendentes = pendentes.filter((item) => faltando.has(chave(item)))
    total.semCotacao = resultado.semCotacao
  }
  total.semToken = todosSemToken
  return total
}

/** Compõe os provedores B3 das integrações numa única porta (cadeia de fallback). */
export function cadeiaCotacoesB3(integracoes: readonly IntegracaoCotacao[]): ProvedorCotacoesB3 {
  const provedores = integracoes.flatMap((integracao) => (integracao.b3 ? [integracao.b3] : []))
  return {
    lerCache(ticker) {
      for (const provedor of provedores) {
        const cotacao = provedor.lerCache(ticker)
        if (cotacao) return cotacao
      }
      return null
    },
    atualizar(tickers, opcoes) {
      return consultarEmCadeia(
        provedores.map((provedor) => (pendentes: readonly string[]) => provedor.atualizar(pendentes, opcoes)),
        tickers,
        (ticker) => ticker.trim().toUpperCase(),
      )
    },
  }
}

/** Compõe os provedores do Tesouro das integrações numa única porta. */
export function cadeiaCotacoesTesouro(
  integracoes: readonly IntegracaoCotacao[],
): ProvedorCotacoesTesouro {
  const provedores = integracoes.flatMap((integracao) =>
    integracao.tesouro ? [integracao.tesouro] : [],
  )
  return {
    lerCache(titulos) {
      const cotacoes = new Map<string, CotacaoMercado>()
      for (const provedor of provedores) {
        const pendentes = titulos.filter(({ ticker }) => !cotacoes.has(ticker))
        if (pendentes.length === 0) break
        for (const [ticker, cotacao] of provedor.lerCache(pendentes)) cotacoes.set(ticker, cotacao)
      }
      return cotacoes
    },
    async atualizar(titulos, opcoes) {
      if (titulos.length === 0) return resultadoVazio()
      return consultarEmCadeia(
        provedores.map(
          (provedor) => (pendentes: readonly TituloTesouroCarteira[]) =>
            provedor.atualizar(pendentes, opcoes),
        ),
        titulos,
        ({ ticker }) => ticker,
      )
    },
  }
}

/** Compõe as listas de tickers: usa a primeira integração que devolver itens. */
export function cadeiaListaTickers(integracoes: readonly IntegracaoCotacao[]): ProvedorListaTickers {
  const provedores = integracoes.flatMap((integracao) =>
    integracao.tickers ? [integracao.tickers] : [],
  )
  return {
    async listar(categoria) {
      for (const provedor of provedores) {
        const tickers = await provedor.listar(categoria)
        if (tickers.length > 0) return tickers
      }
      return []
    },
  }
}
