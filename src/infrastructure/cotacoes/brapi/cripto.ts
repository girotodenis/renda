import { toCentavos } from '@/domain/money'
import type { CotacaoMercado, ResultadoCotacoes } from '@/domain/provedoresCotacao'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Cotação de **criptoativos** via Brapi.dev (`/api/v2/crypto`).
 *
 * - O preço vem na moeda pedida (`currency=BRL`), em reais.
 * - A resposta não traz a abertura do dia: ela é derivada de
 *   `regularMarketChangePercent` (variação móvel de 24 h) para manter a coluna
 *   "Variação Dia (%)".
 * - Requer token e plano com cripto habilitado (Startup/Pro).
 * - **Qualquer falha** (rede, CORS, token ausente, plano sem acesso, formato
 *   inesperado) resulta em "sem cotação" — nunca lança (RNF04).
 */

/** Endpoint de cotações de cripto da Brapi. */
const BRAPI_CRYPTO_URL = 'https://brapi.dev/api/v2/crypto'

/** Tempo máximo de espera pela API antes de desistir (fallback). */
const REQUEST_TIMEOUT_MS = 8000

/** Validade do cache (cripto negocia 24 h; 15 min evita requisições repetidas). */
const CACHE_TTL_MS = 15 * 60 * 1000

const CACHE_PREFIX = 'minhaacoes.brapiCripto.v1.'

/** Moeda usada nas cotações (o app trabalha em reais). */
const MOEDA = 'BRL'

/** Opções da busca de cotações de cripto via Brapi. */
export interface BuscarBrapiCriptoOptions {
  /** Token da Brapi.dev (vazio = integração desligada). */
  token?: string
  /** Ignora o cache local e consulta a API (atualização manual do dashboard). */
  forceRefresh?: boolean
  /** Notifica o ticker que está sendo processado (barra de progresso). */
  onTicker?: (ticker: string) => void
  /** Interrompe a atualização quando o usuário cancela a operação. */
  signal?: AbortSignal
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Converte um preço (reais) em centavos; `null` se ausente/inválido. */
function precoEmCentavos(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const centavos = toCentavos(value)
  return centavos > 0 ? centavos : null
}

/** Data ISO (`YYYY-MM-DD`) a partir de `regularMarketTime`; `null` se inválida. */
function dataISO(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

/**
 * Preço de abertura (fechamento anterior) derivado da variação de 24 h:
 * `preço / (1 + variação%)`. `null` quando a variação é inválida.
 */
function aberturaPelaVariacao(preco: number, variacao: unknown): number | null {
  if (typeof variacao !== 'number' || !Number.isFinite(variacao) || variacao <= -100) return null
  const centavos = toCentavos(preco / 100 / (1 + variacao / 100))
  return centavos > 0 ? centavos : null
}

/**
 * Extrai `ticker → cotação` da resposta da Brapi
 * (`{ coins: [{ coin, regularMarketPrice, regularMarketChangePercent, regularMarketTime }] }`).
 * Entradas inesperadas ou sem preço são ignoradas.
 */
export function extrairCotacoesCripto(payload: unknown): Map<string, CotacaoMercado> {
  const resultado = new Map<string, CotacaoMercado>()
  if (!isRegistro(payload) || payload.error === true) return resultado
  const coins = payload.coins
  if (!Array.isArray(coins)) return resultado

  for (const item of coins) {
    if (!isRegistro(item)) continue
    const simbolo = typeof item.coin === 'string' ? item.coin.trim().toUpperCase() : ''
    const preco = precoEmCentavos(item.regularMarketPrice)
    if (simbolo.length === 0 || preco === null) continue
    resultado.set(simbolo, {
      preco,
      precoAbertura: aberturaPelaVariacao(preco, item.regularMarketChangePercent),
      atualizadoEm: dataISO(item.regularMarketTime),
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

/** Remove as cotações de cripto do cache local (ex.: após trocar o token). */
export function clearBrapiCriptoCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Lê a cotação de cripto do cache local, quando ainda válida. */
export function lerCotacaoCriptoCache(ticker: string): CotacaoMercado | null {
  const registro = lerCache(ticker)
  if (!registro) return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  return { ...registro.valor, fonte: 'cache' }
}

/** Busca (best-effort) a cotação de uma única moeda. Falhas retornam `null`. */
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
    const params = new URLSearchParams({ coin: ticker, currency: MOEDA, token })
    const response = await fetch(`${BRAPI_CRYPTO_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    return extrairCotacoesCripto(await response.json()).get(ticker) ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancelar)
  }
}

/**
 * Atualiza as cotações de cripto dos tickers informados (cache-first, ou direto
 * na API com `forceRefresh`). Nunca lança: devolve o que foi possível obter e
 * **o que faltou**, para a UI avisar o usuário.
 *
 * Uma requisição por moeda (uma sigla inválida não invalida o lote inteiro).
 */
export async function atualizarCotacoesCriptoBrapi(
  tickers: readonly string[],
  options: BuscarBrapiCriptoOptions = {},
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

    const cache = options.forceRefresh ? null : lerCotacaoCriptoCache(normalizado)
    if (cache) cotacoes.set(normalizado, cache)
    else pendentes.push(normalizado)
  }

  const token = typeof options.token === 'string' ? options.token.trim() : ''
  const semToken = token.length === 0
  if (semToken || typeof fetch !== 'function') {
    semCotacao.push(...pendentes)
    return { cotacoes, semCotacao, semToken, consultouRede: false }
  }

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
