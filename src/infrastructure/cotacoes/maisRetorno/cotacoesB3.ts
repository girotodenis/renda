import { parseDecimalBR, toCentavos } from '@/domain/money'
import type { CotacaoMercado, ResultadoCotacoes } from '@/domain/provedoresCotacao'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Cotação de **B3 (Ação/FII/BDR/ETF)** via Mais Retorno
 * (`/quotes/{identifier}`), usada como fallback na cadeia de integrações.
 *
 * Estratégia:
 * - Endpoint autenticado por `X-Api-Key` (CORS liberado: `allow-origin: *`,
 *   preflight aceita o header `x-api-key`).
 * - **1 crédito por chamada**: uma requisição por ticker, sempre cache-first.
 *   O cache local segue o `Cache-Control` documentado (90 min).
 * - A API entrega **fechamentos diários**; o "preço de abertura" usado como
 *   referência do dia é o **fechamento anterior** da série.
 * - **Qualquer falha** (rede, token ausente, 401/403/429, formato inesperado)
 *   resulta em "sem cotação" — o app segue com o preço médio e nunca trava.
 */

/** Base URL da Market Data API (v4). */
const BASE_URL = 'https://data.maisretorno.com/mr-data/v4/api'

/** Tempo máximo de espera pela API antes de desistir (fallback). */
const REQUEST_TIMEOUT_MS = 10000

/** Validade do cache: o próprio endpoint documenta `max-age` de 90 min. */
const CACHE_TTL_MS = 90 * 60 * 1000

/** Janela de datas (dias) — cabe feriados longos sem custo extra (1 crédito por chamada). */
const JANELA_DIAS = 20

const CACHE_PREFIX = 'minhaacoes.maisRetorno.v1.'

/** Identifier da API para um ticker da B3 (`PETR4` → `petr4:b3`). */
export function identificadorB3(ticker: string): string {
  return `${ticker.trim().toLowerCase()}:b3`
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Converte um preço (reais) em centavos; `null` se ausente/inválido. */
function precoEmCentavos(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const centavos = toCentavos(value)
    return centavos > 0 ? centavos : null
  }
  if (typeof value === 'string') {
    const parsed = parseDecimalBR(value)
    if (parsed !== null && parsed > 0) return toCentavos(parsed)
  }
  return null
}

/** Data ISO (`YYYY-MM-DD`) a partir de `d`; `null` se inválida. */
function dataISO(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

/**
 * Extrai a cotação de um ativo a partir da resposta de `/quotes`
 * (`{ quotes: [{ d, c, p, q }] }`), usando o fechamento mais recente e, como
 * referência de variação do dia, o fechamento imediatamente anterior.
 * `null` quando não há nenhum fechamento válido.
 */
export function extrairCotacao(payload: unknown): CotacaoMercado | null {
  if (!isRegistro(payload) || payload.error === true) return null
  const quotes = payload.quotes
  if (!Array.isArray(quotes)) return null

  const serie = quotes
    .map((item) => {
      if (!isRegistro(item)) return null
      const preco = precoEmCentavos(item.c)
      const data = dataISO(item.d)
      return preco !== null && data !== null ? { data, preco } : null
    })
    .filter((ponto): ponto is { data: string; preco: number } => ponto !== null)
    .sort((a, b) => a.data.localeCompare(b.data))

  const ultimo = serie.at(-1)
  if (!ultimo) return null
  return {
    preco: ultimo.preco,
    precoAbertura: serie.at(-2)?.preco ?? null,
    atualizadoEm: ultimo.data,
    fonte: 'api',
  }
}

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`
}

function lerCache(ticker: string): { valor: CotacaoMercado; gravadoEm: number } | null {
  const registro = readStorageJson<{ cotacao: CotacaoMercado; gravadoEm: number }>(cacheKey(ticker))
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  return { valor: registro.cotacao, gravadoEm: registro.gravadoEm }
}

function gravarCache(ticker: string, cotacao: CotacaoMercado): void {
  writeStorageJson(cacheKey(ticker), { cotacao, gravadoEm: Date.now() })
}

/** Remove as cotações B3 do cache local (ex.: após trocar o token). */
export function clearMaisRetornoCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Lê a cotação do cache local, quando ainda válida. */
export function lerCotacaoCache(ticker: string): CotacaoMercado | null {
  const registro = lerCache(ticker)
  if (!registro) return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  return { ...registro.valor, fonte: 'cache' }
}

/** Datas ISO da janela consultada (`YYYY-MM-DD`), com folga para feriados. */
function janela(atual: Date): { inicio: string; fim: string } {
  const inicio = new Date(atual)
  inicio.setUTCDate(inicio.getUTCDate() - JANELA_DIAS)
  return { inicio: inicio.toISOString().slice(0, 10), fim: atual.toISOString().slice(0, 10) }
}

/** Url de `/quotes` de um identifier na janela padrão. */
export function urlCotacao(identifier: string, agora = new Date()): string {
  const { inicio, fim } = janela(agora)
  const params = new URLSearchParams({ start_date: inicio, end_date: fim, adjusted: 'false' })
  return `${BASE_URL}/quotes/${encodeURIComponent(identifier)}?${params.toString()}`
}

/** Busca (best-effort) a cotação de um único ticker. Falhas retornam `null`. */
async function buscarCotacao(ticker: string, token: string): Promise<CotacaoMercado | null> {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(urlCotacao(identificadorB3(ticker)), {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Api-Key': token },
    })
    if (!response.ok) return null
    return extrairCotacao(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Atualiza as cotações B3 dos tickers informados (cache-first, ou direto na
 * API com `forceRefresh`). Nunca lança: devolve o que foi possível obter e **o
 * que faltou**, para a UI avisar o usuário.
 */
export async function atualizarCotacoesMaisRetorno(
  tickers: readonly string[],
  options: { token?: string; forceRefresh?: boolean } = {},
): Promise<ResultadoCotacoes> {
  const cotacoes = new Map<string, CotacaoMercado>()
  const semCotacao: string[] = []
  const pendentes: string[] = []
  const consultados = new Set<string>()

  for (const ticker of tickers) {
    const normalizado = ticker.trim().toUpperCase()
    if (normalizado.length === 0 || consultados.has(normalizado)) continue
    consultados.add(normalizado)
    const cache = options.forceRefresh ? null : lerCotacaoCache(normalizado)
    if (cache) cotacoes.set(normalizado, cache)
    else pendentes.push(normalizado)
  }

  const token = typeof options.token === 'string' ? options.token.trim() : ''
  const semToken = token.length === 0
  if (semToken) {
    semCotacao.push(...pendentes)
    return { cotacoes, semCotacao, semToken, consultouRede: false }
  }

  let consultouRede = false
  for (const ticker of pendentes) {
    consultouRede = true
    const cotacao = await buscarCotacao(ticker, token)
    if (!cotacao) {
      semCotacao.push(ticker)
      continue
    }
    gravarCache(ticker, cotacao)
    cotacoes.set(ticker, cotacao)
  }

  return { cotacoes, semCotacao, semToken, consultouRede }
}
