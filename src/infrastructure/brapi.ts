import { parseDecimalBR, toCentavos } from '@/lib/money'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/lib/storage'

/**
 * Cotação de **B3 (Ação/FII/BDR/ETF)** via Brapi.dev, usada como **fallback**
 * quando o `GOOGLEFINANCE` da planilha não retorna preço (RNF04).
 *
 * Estratégia (espelha o adaptador do Tesouro Direto):
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
}

/** Normaliza o token recebido; vazio quando não configurado. */
function resolverToken(token?: string): string {
  return typeof token === 'string' ? token.trim() : ''
}

/** Cotação de um ticker B3. */
export interface BrapiCotacao {
  /** Preço unitário em **centavos**. */
  preco: number
  /** ISO da última atualização conhecida (`null` quando desconhecida). */
  atualizadoEm: string | null
  fonte: 'api' | 'cache'
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
 * (`{ results: [{ symbol, regularMarketPrice, regularMarketTime }] }`).
 * Entradas inesperadas ou sem preço são ignoradas.
 */
export function extrairCotacoes(payload: unknown): Map<string, BrapiCotacao> {
  const resultado = new Map<string, BrapiCotacao>()
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
      atualizadoEm: extrairData(item.regularMarketTime),
      fonte: 'api',
    })
  }
  return resultado
}

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`
}

function lerCache(ticker: string): { valor: BrapiCotacao; gravadoEm: number } | null {
  const registro = readStorageJson<{ cotacao: BrapiCotacao; gravadoEm: number }>(cacheKey(ticker))
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  return { valor: registro.cotacao, gravadoEm: registro.gravadoEm }
}

function gravarCache(ticker: string, cotacao: BrapiCotacao): void {
  writeStorageJson(cacheKey(ticker), { cotacao, gravadoEm: Date.now() })
}

/** Remove as cotações B3 do cache local (ex.: após trocar o token). */
export function clearBrapiCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Lê a cotação do cache local, quando ainda válida. */
export function lerCotacaoCache(ticker: string): BrapiCotacao | null {
  const registro = lerCache(ticker)
  if (!registro) return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  return { ...registro.valor, fonte: 'cache' }
}

/**
 * Busca cotações B3 (centavos) para os tickers informados (cache-first).
 * Nunca lança: em caso de falha retorna apenas o que estiver disponível.
 *
 * O token é resolvido por `options.token` (config do usuário na planilha);
 * quando vazio, o fallback fica desligado (apenas cache).
 */
export async function buscarCotacoesBrapi(
  tickers: readonly string[],
  options: BuscarBrapiOptions = {},
): Promise<Map<string, number>> {
  const resultado = new Map<string, number>()
  const pendentes: string[] = []

  for (const ticker of tickers) {
    const normalizado = ticker.trim().toUpperCase()
    if (normalizado.length === 0 || resultado.has(normalizado)) continue
    const cache = lerCotacaoCache(normalizado)
    if (cache) resultado.set(normalizado, cache.preco)
    else pendentes.push(normalizado)
  }

  if (pendentes.length === 0) return resultado
  const token = resolverToken(options.token)
  if (token.length === 0) return resultado
  if (typeof fetch !== 'function') return resultado

  // O plano gratuito da Brapi permite apenas 1 ativo por requisição — buscamos
  // um ticker por vez. Falhas individuais são ignoradas (best-effort).
  for (const ticker of pendentes) {
    const cotacao = await buscarCotacao(ticker, token)
    if (!cotacao) continue
    gravarCache(ticker, cotacao)
    resultado.set(ticker, cotacao.preco)
  }
  return resultado
}

/** Busca (best-effort) a cotação de um único ticker. Falhas retornam `null`. */
async function buscarCotacao(
  ticker: string,
  token: string,
): Promise<BrapiCotacao | null> {
  if (typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
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
  }
}
