import { parseDecimalBR, toCentavos } from '@/domain/money'
import type { CotacaoMercado, ResultadoCotacoes } from '@/domain/provedoresCotacao'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Cotação de **B3 (Ação/FII/BDR/ETF)** via Brapi.dev, usada como **fallback**
 * quando o `GOOGLEFINANCE` da planilha não retorna preço (RNF04).
 *
 * Estratégia:
 * - Cache local com TTL (cotações mudam intradia, então TTL curto).
 * - Uma requisição por ticker (o plano gratuito da Brapi limita a 1 ativo por chamada).
 * - **Qualquer falha** (rede, CORS, token ausente, formato inesperado) resulta
 *   em "sem cotação" — o app segue com o preço médio e nunca trava a UI.
 */

/** Endpoint base de cotações da Brapi (sem token). */
const DEFAULT_BRAPI_API_URL = 'https://brapi.dev/api/quote'

/** Tempo máximo de espera pela API antes de desistir (fallback). */
const REQUEST_TIMEOUT_MS = 8000

/** Validade do cache (cotações intraday; 15 min evita requisições repetidas). */
const CACHE_TTL_MS = 15 * 60 * 1000

const CACHE_PREFIX = 'minhaacoes.brapi.v1.'

/** Opções da busca de cotações B3 via Brapi. */
export interface BuscarBrapiOptions {
  /** Token da Brapi.dev (vazio = fallback desligado). */
  token?: string
  /** Ignora o cache local e consulta a API (atualização manual do dashboard). */
  forceRefresh?: boolean
  /** Notifica o ticker que está sendo processado (barra de progresso). */
  onTicker?: (ticker: string) => void
  /** Interrompe a atualização quando o usuário cancela a operação. */
  signal?: AbortSignal
}

/** Normaliza o token recebido; vazio quando não configurado. */
function resolverToken(token?: string): string {
  return typeof token === 'string' ? token.trim() : ''
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Converte `regularMarketPrice` (reais) em centavos; `null` se ausente/inválido. */
function extrairPreco(value: unknown): number | null {
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

/** Converte `regularMarketTime` (ISO) em `YYYY-MM-DD`; `null` se inválida. */
function extrairData(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

/**
 * Extrai `ticker → cotação` da resposta da Brapi
 * (`{ results: [{ symbol, regularMarketPrice, regularMarketOpen, regularMarketTime }] }`).
 * A abertura vem na mesma resposta (sem chamada extra) e alimenta a coluna
 * "Variação Dia (%)". Entradas inesperadas ou sem preço são ignoradas.
 */
export function extrairCotacoes(payload: unknown): Map<string, CotacaoMercado> {
  const resultado = new Map<string, CotacaoMercado>()
  if (!isRegistro(payload) || payload.error === true) return resultado
  const results = payload.results
  if (!Array.isArray(results)) return resultado

  for (const item of results) {
    if (!isRegistro(item)) continue
    const symbol = typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : ''
    const preco = extrairPreco(item.regularMarketPrice)
    if (symbol.length === 0 || preco === null) continue
    resultado.set(symbol, {
      preco,
      precoAbertura: extrairPreco(item.regularMarketOpen),
      atualizadoEm: extrairData(item.regularMarketTime),
      fonte: 'api',
    })
  }
  return resultado
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
export function clearBrapiCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Lê a cotação do cache local, quando ainda válida. */
export function lerCotacaoCache(ticker: string): CotacaoMercado | null {
  const registro = lerCache(ticker)
  if (!registro) return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  return { ...registro.valor, fonte: 'cache' }
}

/**
 * Atualiza as cotações B3 dos tickers informados (cache-first, ou direto na API
 * com `forceRefresh`). Nunca lança: devolve o que foi possível obter e **o que
 * faltou**, para a UI avisar o usuário.
 *
 * O token é resolvido por `options.token` (config do usuário na planilha);
 * quando vazio, a integração fica desligada (`semToken: true`, apenas cache).
 */
export async function atualizarCotacoesBrapi(
  tickers: readonly string[],
  options: BuscarBrapiOptions = {},
): Promise<ResultadoCotacoes> {
  const cotacoes = new Map<string, CotacaoMercado>()
  const semCotacao: string[] = []
  const pendentes: string[] = []
  const consultados = new Set<string>()

  for (const ticker of tickers) {
    const normalizado = ticker.trim().toUpperCase()
    if (normalizado.length === 0 || consultados.has(normalizado)) continue
    consultados.add(normalizado)
    options.onTicker?.(normalizado)

    const cache = options.forceRefresh ? null : lerCotacaoCache(normalizado)
    if (cache) cotacoes.set(normalizado, cache)
    else pendentes.push(normalizado)
  }

  const token = resolverToken(options.token)
  const semToken = token.length === 0
  if (semToken || typeof fetch !== 'function') {
    semCotacao.push(...pendentes)
    return { cotacoes, semCotacao, semToken, consultouRede: false }
  }

  // O plano gratuito da Brapi permite apenas 1 ativo por requisição — buscamos
  // um ticker por vez. Falhas individuais são registradas (best-effort).
  let consultouRede = false
  for (const ticker of pendentes) {
    if (options.signal?.aborted) break
    consultouRede = true
    const cotacao = await buscarCotacao(ticker, token, options.signal)
    if (!cotacao) {
      semCotacao.push(ticker)
      continue
    }
    gravarCache(ticker, cotacao)
    cotacoes.set(ticker, cotacao)
  }

  return { cotacoes, semCotacao, semToken, consultouRede }
}

/**
 * Busca cotações B3 (centavos) para os tickers informados (cache-first).
 * Nunca lança: em caso de falha retorna apenas o que estiver disponível.
 *
 * Atalho de `atualizarCotacoesBrapi` para os fluxos que só precisam dos preços.
 */
export async function buscarCotacoesBrapi(
  tickers: readonly string[],
  options: BuscarBrapiOptions = {},
): Promise<Map<string, number>> {
  const { cotacoes } = await atualizarCotacoesBrapi(tickers, options)
  const precos = new Map<string, number>()
  for (const [ticker, cotacao] of cotacoes) precos.set(ticker, cotacao.preco)
  return precos
}

/** Busca (best-effort) a cotação de um único ticker. Falhas retornam `null`. */
async function buscarCotacao(
  ticker: string,
  token: string,
  signal?: AbortSignal,
): Promise<CotacaoMercado | null> {
  if (typeof AbortController !== 'function' || signal?.aborted) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const cancelar = () => controller.abort()
  signal?.addEventListener('abort', cancelar, { once: true })
  try {
    const url = `${DEFAULT_BRAPI_API_URL}/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    return extrairCotacoes(payload).get(ticker) ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancelar)
  }
}
