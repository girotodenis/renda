import { encontrarTituloTesouro } from '@/domain/tesouro'
import type { TituloTesouro } from '@/domain/tesouro'
import type {
  CotacaoMercado,
  ResultadoCotacoes,
  TituloTesouroCarteira,
} from '@/domain/provedoresCotacao'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'
import { extrairCotacao } from '@/infrastructure/cotacoes/maisRetorno/cotacoesB3'

/**
 * Preços do **Tesouro Direto** via Mais Retorno.
 *
 * - `GET /search/tesouro` (grátis) lista os títulos com cotações; o identifier
 *   já traz o vencimento (`tesouro-selic-18-06-2008:td`), então o casamento
 *   com os tickers da carteira é local (`encontrarTituloTesouro`).
 * - `GET /quotes/{identifier}` (1 crédito) é chamado **apenas** para os títulos
 *   que a carteira realmente possui.
 * - Os dados do Tesouro mudam uma vez por dia: cache local de 6 h para a lista
 *   e de 90 min para o preço.
 * - **Nunca lança**: sem token, sem plano ou sem rede, os títulos ficam sem
 *   cotação e o app segue com a marcação manual / estimativa (RNF04).
 */

const BASE_URL = 'https://data.maisretorno.com/mr-data/v4/api'
const REQUEST_TIMEOUT_MS = 10000
const CACHE_TTL_TITULOS_MS = 6 * 60 * 60 * 1000
const CACHE_TTL_COTACAO_MS = 90 * 60 * 1000
const CACHE_PREFIX = 'minhaacoes.maisRetorno.v1.tesouro.'

const CACHE_KEY_TITULOS = `${CACHE_PREFIX}titulos`

interface CacheTitulos {
  titulos: TituloTesouro[]
  gravadoEm: number
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `dd-mm-yyyy` (formato do identifier) → `yyyy-mm-dd`. */
function dataDoSlug(valor: string): string | null {
  const match = valor.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

/** Nome legível a partir do slug (`tesouro-ipca-com-juros-semestrais`). */
function nomeDoSlug(slug: string): string {
  return slug
    .split('-')
    .filter((parte) => parte.length > 0)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ')
}

/**
 * Extrai os títulos do Tesouro da resposta de `/search` (array de
 * `{ identifier, nicename, type, has_quotes }`). O identifier tem o formato
 * `slug-dd-mm-yyyy:td`; o preço é preenchido depois, só para os títulos
 * casados com a carteira (por isso `preco: 0`).
 */
export function extrairTitulosTesouro(payload: unknown): TituloTesouro[] {
  if (!Array.isArray(payload)) return []
  const titulos: TituloTesouro[] = []
  const vistos = new Set<string>()
  for (const item of payload) {
    if (!isRegistro(item)) continue
    const identifier = typeof item.identifier === 'string' ? item.identifier.trim().toLowerCase() : ''
    if (!identifier.endsWith(':td')) continue
    const slug = identifier.slice(0, -':td'.length)
    const partes = slug.match(/^(.*)-(\d{2})-(\d{2})-(\d{4})$/)
    if (!partes) continue
    const maturityDate = dataDoSlug(`${partes[2]}-${partes[3]}-${partes[4]}`)
    const nome = (partes[1] ?? '').trim()
    if (!maturityDate || nome.length === 0 || vistos.has(slug)) continue
    vistos.add(slug)
    titulos.push({ symbol: slug, bondType: nomeDoSlug(nome), maturityDate, preco: 0, dataBase: null })
  }
  return titulos
}

function lerCacheTitulos(): CacheTitulos | null {
  const registro = readStorageJson<CacheTitulos>(CACHE_KEY_TITULOS)
  if (!registro || typeof registro.gravadoEm !== 'number' || !Array.isArray(registro.titulos)) {
    return null
  }
  return registro
}

/** Títulos em cache ainda válidos (`null` quando ausente ou vencido). */
function titulosDoCache(): TituloTesouro[] | null {
  const cache = lerCacheTitulos()
  if (!cache || Date.now() - cache.gravadoEm > CACHE_TTL_TITULOS_MS) return null
  return cache.titulos
}

function cacheKeyCotacao(symbol: string): string {
  return `${CACHE_PREFIX}${symbol}`
}

function lerCacheCotacao(symbol: string): CotacaoMercado | null {
  const registro = readStorageJson<{ cotacao: CotacaoMercado; gravadoEm: number }>(
    cacheKeyCotacao(symbol),
  )
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_COTACAO_MS) return null
  return { ...registro.cotacao, fonte: 'cache' }
}

function gravarCacheCotacao(symbol: string, cotacao: CotacaoMercado): void {
  writeStorageJson(cacheKeyCotacao(symbol), { cotacao, gravadoEm: Date.now() })
}

/** Remove títulos e preços do Tesouro do cache local (ex.: após trocar o token). */
export function clearMaisRetornoTesouroCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Busca (best-effort) os títulos com cotação. Falhas retornam `null`. */
async function baixarTitulos(token: string): Promise<TituloTesouro[] | null> {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE_URL}/search/tesouro?has_quotes=true`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Api-Key': token },
    })
    if (!response.ok) return null
    const titulos = extrairTitulosTesouro(await response.json())
    if (titulos.length === 0) return null
    writeStorageJson(CACHE_KEY_TITULOS, { titulos, gravadoEm: Date.now() } satisfies CacheTitulos)
    return titulos
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Preço (PU) de um título via `/quotes`; `null` em qualquer falha. */
async function buscarCotacao(symbol: string, token: string): Promise<CotacaoMercado | null> {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const inicio = new Date()
  inicio.setUTCDate(inicio.getUTCDate() - 20)
  const params = new URLSearchParams({
    start_date: inicio.toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    adjusted: 'false',
  })
  try {
    const response = await fetch(
      `${BASE_URL}/quotes/${encodeURIComponent(`${symbol}:td`)}?${params.toString()}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'X-Api-Key': token },
      },
    )
    if (!response.ok) return null
    const cotacao = extrairCotacao(await response.json())
    // Tesouro Direto não exibe variação do dia (mesmo comportamento da Brapi).
    return cotacao ? { ...cotacao, precoAbertura: null } : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Casa os tickers com os títulos e devolve o título correspondente. */
function casar(
  tickers: readonly TituloTesouroCarteira[],
  titulos: readonly TituloTesouro[],
): Map<string, TituloTesouro> {
  const casados = new Map<string, TituloTesouro>()
  for (const { ticker, vencimento } of tickers) {
    if (casados.has(ticker)) continue
    const titulo = encontrarTituloTesouro(ticker, titulos, vencimento)
    if (titulo) casados.set(ticker, titulo)
  }
  return casados
}

/** Cotações do Tesouro a partir do cache local (modo offline). */
export function lerCotacoesTesouroCache(
  tickers: readonly TituloTesouroCarteira[],
): Map<string, CotacaoMercado> {
  const titulos = titulosDoCache()
  if (!titulos) return new Map()
  const cotacoes = new Map<string, CotacaoMercado>()
  for (const [ticker, titulo] of casar(tickers, titulos)) {
    const cache = lerCacheCotacao(titulo.symbol)
    if (cache) cotacoes.set(ticker, cache)
  }
  return cotacoes
}

/**
 * Atualiza os preços dos títulos do Tesouro informados (cache-first, ou direto
 * na API com `forceRefresh`). Mesmo contrato de `atualizarCotacoesMaisRetorno`.
 */
export async function atualizarCotacoesTesouroMaisRetorno(
  tickers: readonly TituloTesouroCarteira[],
  options: { token?: string; forceRefresh?: boolean } = {},
): Promise<ResultadoCotacoes> {
  const token = typeof options.token === 'string' ? options.token.trim() : ''
  const semToken = token.length === 0
  if (tickers.length === 0) {
    return { cotacoes: new Map(), semCotacao: [], semToken, consultouRede: false }
  }

  const doCache = options.forceRefresh ? null : titulosDoCache()
  if (!doCache && semToken) {
    const semCotacao = [...new Set(tickers.map(({ ticker }) => ticker))]
    return { cotacoes: new Map(), semCotacao, semToken, consultouRede: false }
  }

  const titulos = doCache ?? (await baixarTitulos(token))
  const consultouRedeNaLista = doCache === null
  if (!titulos) {
    const semCotacao = [...new Set(tickers.map(({ ticker }) => ticker))]
    return { cotacoes: new Map(), semCotacao, semToken, consultouRede: consultouRedeNaLista }
  }

  const casados = casar(tickers, titulos)
  const cotacoes = new Map<string, CotacaoMercado>()
  const semCotacao: string[] = []
  let consultouRede = consultouRedeNaLista

  for (const { ticker } of tickers) {
    if (cotacoes.has(ticker) || semCotacao.includes(ticker)) continue
    const titulo = casados.get(ticker)
    if (!titulo) {
      semCotacao.push(ticker)
      continue
    }
    const cache = options.forceRefresh ? null : lerCacheCotacao(titulo.symbol)
    if (cache) {
      cotacoes.set(ticker, cache)
      continue
    }
    if (semToken) {
      semCotacao.push(ticker)
      continue
    }
    consultouRede = true
    const cotacao = await buscarCotacao(titulo.symbol, token)
    if (!cotacao) {
      semCotacao.push(ticker)
      continue
    }
    gravarCacheCotacao(titulo.symbol, cotacao)
    cotacoes.set(ticker, cotacao)
  }

  return { cotacoes, semCotacao, semToken, consultouRede }
}
