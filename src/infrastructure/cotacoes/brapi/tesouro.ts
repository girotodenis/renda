import { toCentavos } from '@/domain/money'
import { encontrarTituloTesouro } from '@/domain/tesouro'
import type { TituloTesouro } from '@/domain/tesouro'
import type {
  CotacaoMercado,
  ResultadoCotacoes,
  TituloTesouroCarteira,
} from '@/domain/provedoresCotacao'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Preços do **Tesouro Direto** via Brapi (`/api/v2/treasury/list`, plano Pro).
 *
 * - Uma listagem (paginada) traz todos os títulos; o casamento com os tickers
 *   da carteira é local (`encontrarTituloTesouro`).
 * - Os dados do Tesouro Nacional mudam uma vez por dia: cache local de 6 h.
 * - **Nunca lança**: sem token, sem plano ou sem rede, os títulos ficam sem
 *   cotação e o app segue com a marcação manual / estimativa (RNF04).
 */

const BRAPI_TREASURY_LIST_URL = 'https://brapi.dev/api/v2/treasury/list'
const REQUEST_TIMEOUT_MS = 10000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_KEY = 'minhaacoes.brapiTesouro.v1.titulos'
const LIMITE_POR_PAGINA = 100
const MAX_PAGINAS = 5

interface CacheTitulos {
  titulos: TituloTesouro[]
  gravadoEm: number
}

function lerCache(): CacheTitulos | null {
  const registro = readStorageJson<CacheTitulos>(CACHE_KEY)
  if (!registro || typeof registro.gravadoEm !== 'number' || !Array.isArray(registro.titulos)) {
    return null
  }
  return registro
}

/** Títulos em cache ainda válidos (`null` quando ausente ou vencido). */
function titulosDoCache(): TituloTesouro[] | null {
  const cache = lerCache()
  if (!cache || Date.now() - cache.gravadoEm > CACHE_TTL_MS) return null
  return cache.titulos
}

/** Remove os títulos do Tesouro do cache local (ex.: após trocar o token). */
export function clearBrapiTesouroCache(): void {
  clearStorageKeys(CACHE_KEY)
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function precoEmCentavos(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return toCentavos(value)
}

function dataISO(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

/**
 * Extrai os títulos da resposta da Brapi (`{ results: [...] }`, usada por
 * `/treasury/list` e `/treasury/indicators`). O preço é o de **resgate**
 * (`sellPrice`, com `basePrice` como alternativa) — o valor de mercado de
 * quem já tem o título. Itens inválidos são ignorados.
 */
export function extrairTitulosTesouro(payload: unknown): TituloTesouro[] {
  if (!isRegistro(payload) || payload.error === true || !Array.isArray(payload.results)) {
    return []
  }
  const titulos: TituloTesouro[] = []
  for (const item of payload.results) {
    if (!isRegistro(item)) continue
    const symbol = typeof item.symbol === 'string' ? item.symbol.trim().toLowerCase() : ''
    const bondType = typeof item.bondType === 'string' ? item.bondType.trim() : ''
    const maturityDate = dataISO(item.maturityDate)
    const preco = precoEmCentavos(item.sellPrice) ?? precoEmCentavos(item.basePrice)
    if (symbol.length === 0 || !maturityDate || preco === null) continue
    titulos.push({ symbol, bondType, maturityDate, preco, dataBase: dataISO(item.baseDate) })
  }
  return titulos
}

/** Baixa todas as páginas da listagem; `null` em qualquer falha. */
async function baixarTitulos(token: string): Promise<TituloTesouro[] | null> {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const titulos: TituloTesouro[] = []
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const url =
        `${BRAPI_TREASURY_LIST_URL}?page=${pagina}&limit=${LIMITE_POR_PAGINA}` +
        `&token=${encodeURIComponent(token)}`
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return null
      const payload: unknown = await response.json()
      titulos.push(...extrairTitulosTesouro(payload))
      const paginacao = isRegistro(payload) ? payload.pagination : null
      if (!isRegistro(paginacao) || paginacao.hasNextPage !== true) break
    }
    return titulos.length > 0 ? titulos : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function cotacaoDoTitulo(titulo: TituloTesouro, fonte: CotacaoMercado['fonte']): CotacaoMercado {
  return { preco: titulo.preco, precoAbertura: null, atualizadoEm: titulo.dataBase, fonte }
}

/** Casa os tickers com os títulos (chave = ticker como informado). */
function cotarTickers(
  tickers: readonly TituloTesouroCarteira[],
  titulos: readonly TituloTesouro[],
  fonte: CotacaoMercado['fonte'],
): { cotacoes: Map<string, CotacaoMercado>; semCotacao: string[] } {
  const cotacoes = new Map<string, CotacaoMercado>()
  const semCotacao: string[] = []
  for (const { ticker, vencimento } of tickers) {
    if (cotacoes.has(ticker) || semCotacao.includes(ticker)) continue
    const titulo = encontrarTituloTesouro(ticker, titulos, vencimento)
    if (titulo) cotacoes.set(ticker, cotacaoDoTitulo(titulo, fonte))
    else semCotacao.push(ticker)
  }
  return { cotacoes, semCotacao }
}

/** Cotações do Tesouro a partir do cache local válido (modo offline). */
export function lerCotacoesTesouroCache(
  tickers: readonly TituloTesouroCarteira[],
): Map<string, CotacaoMercado> {
  const titulos = titulosDoCache()
  if (!titulos) return new Map()
  return cotarTickers(tickers, titulos, 'cache').cotacoes
}

/**
 * Atualiza os preços dos títulos do Tesouro informados (cache-first, ou direto
 * na API com `forceRefresh`). Mesmo contrato de `atualizarCotacoesBrapi`.
 */
export async function atualizarCotacoesTesouroBrapi(
  tickers: readonly TituloTesouroCarteira[],
  options: { token?: string; forceRefresh?: boolean } = {},
): Promise<ResultadoCotacoes> {
  const token = typeof options.token === 'string' ? options.token.trim() : ''
  const semToken = token.length === 0
  if (tickers.length === 0) {
    return { cotacoes: new Map(), semCotacao: [], semToken, consultouRede: false }
  }

  const cache = options.forceRefresh ? null : titulosDoCache()
  if (cache) return { ...cotarTickers(tickers, cache, 'cache'), semToken, consultouRede: false }

  if (semToken) {
    const semCotacao = [...new Set(tickers.map(({ ticker }) => ticker))]
    return { cotacoes: new Map(), semCotacao, semToken, consultouRede: false }
  }

  const titulos = await baixarTitulos(token)
  if (!titulos) {
    const semCotacao = [...new Set(tickers.map(({ ticker }) => ticker))]
    return { cotacoes: new Map(), semCotacao, semToken, consultouRede: true }
  }
  writeStorageJson(CACHE_KEY, { titulos, gravadoEm: Date.now() } satisfies CacheTitulos)
  return { ...cotarTickers(tickers, titulos, 'api'), semToken, consultouRede: true }
}
