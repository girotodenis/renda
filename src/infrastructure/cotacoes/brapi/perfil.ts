import type {
  OpcoesConsultaCotacoes,
  ProvedorSetores,
  ResultadoSetores,
} from '@/domain/provedoresCotacao'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Setor de atuação de **B3 (Ação/FII/BDR/ETF)** via Brapi.dev
 * (`/api/v2/stocks/profile`), primeira opção da cadeia de setores.
 *
 * Estratégia:
 * - `Authorization: Bearer <token>` (recomendação da doc para novas chamadas).
 * - Uma requisição por ticker (o plano gratuito da Brapi limita a 1 ativo por
 *   chamada) — o setor é dado quase estático, então o cache local é longo.
 * - **Qualquer falha** (rede, CORS, token ausente, formato inesperado) resulta
 *   em "sem setor" — o gráfico simplesmente omite o ativo.
 */

/** Endpoint base do perfil da empresa (razão social, setor, indústria). */
const BRAPI_PROFILE_URL = 'https://brapi.dev/api/v2/stocks/profile'

/** Tempo máximo de espera pela API antes de desistir. */
const REQUEST_TIMEOUT_MS = 8000

/** Setor muda muito raramente: 30 dias de cache evitam requisições repetidas. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const CACHE_PREFIX = 'minhaacoes.brapiSetor.v1.'

/** Normaliza o token recebido; vazio quando não configurado. */
function resolverToken(token?: string): string {
  return typeof token === 'string' ? token.trim() : ''
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function texto(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Setor do registro: `sector` (chave estável) e, como fallback, `sectorDisp`. */
function setorDoItem(item: Record<string, unknown>): string {
  const data = isRegistro(item.data) ? item.data : item
  return texto(data.sector) || texto(data.sectorDisp)
}

/**
 * Extrai `ticker → setor` da resposta de `/api/v2/stocks/profile`
 * (`{ results: [{ symbol, data: { sector, sectorDisp } }] }`).
 * Entradas sem setor são ignoradas.
 */
export function extrairSetores(payload: unknown): Map<string, string> {
  const setores = new Map<string, string>()
  if (!isRegistro(payload) || payload.error === true) return setores
  const results = payload.results
  if (!Array.isArray(results)) return setores

  for (const item of results) {
    if (!isRegistro(item)) continue
    const ticker = texto(item.symbol) || texto(item.requestedSymbol)
    const setor = setorDoItem(item)
    if (ticker.length === 0 || setor.length === 0) continue
    setores.set(ticker.toUpperCase(), setor)
  }
  return setores
}

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`
}

/** Lê o setor do cache local, quando ainda válido. */
export function lerSetorCache(ticker: string): string | null {
  const registro = readStorageJson<{ setor: string; gravadoEm: number }>(cacheKey(ticker))
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  const setor = texto(registro.setor)
  return setor.length > 0 ? setor : null
}

function gravarCache(ticker: string, setor: string): void {
  writeStorageJson(cacheKey(ticker), { setor, gravadoEm: Date.now() })
}

/** Remove os setores do cache local (ex.: após trocar o token). */
export function clearBrapiSetorCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Busca (best-effort) o setor de um único ticker. Falhas retornam `null`. */
async function buscarSetor(ticker: string, token: string): Promise<string | null> {
  if (typeof AbortController !== 'function' || typeof fetch !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = `${BRAPI_PROFILE_URL}?symbols=${encodeURIComponent(ticker)}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    const setores = extrairSetores(payload)
    return setores.get(ticker.toUpperCase()) ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Consulta os setores de B3 (cache-first, um ticker por requisição).
 * Nunca lança: devolve o que foi possível obter e o que faltou.
 */
export async function atualizarSetoresBrapi(
  tickers: readonly string[],
  opcoes: OpcoesConsultaCotacoes = { tokens: {} },
): Promise<ResultadoSetores> {
  const setores = new Map<string, string>()
  const semSetor: string[] = []
  const pendentes: string[] = []
  const consultados = new Set<string>()

  for (const ticker of tickers) {
    const normalizado = ticker.trim().toUpperCase()
    if (normalizado.length === 0 || consultados.has(normalizado)) continue
    consultados.add(normalizado)

    const cache = opcoes.forceRefresh ? null : lerSetorCache(normalizado)
    if (cache) setores.set(normalizado, cache)
    else pendentes.push(normalizado)
  }

  const token = resolverToken(opcoes.tokens.brapi)
  if (token.length === 0) {
    semSetor.push(...pendentes)
    return { setores, semSetor, semToken: true, consultouRede: false }
  }

  let consultouRede = false
  for (const ticker of pendentes) {
    consultouRede = true
    const setor = await buscarSetor(ticker, token)
    if (!setor) {
      semSetor.push(ticker)
      continue
    }
    gravarCache(ticker, setor)
    setores.set(ticker, setor)
  }

  return { setores, semSetor, semToken: false, consultouRede }
}

/** Porta de setores da Brapi (usada na cadeia de integrações). */
export const provedorSetoresBrapi: ProvedorSetores = {
  lerCache(tickers) {
    const setores = new Map<string, string>()
    for (const ticker of tickers) {
      const normalizado = ticker.trim().toUpperCase()
      if (normalizado.length === 0) continue
      const setor = lerSetorCache(normalizado)
      if (setor) setores.set(normalizado, setor)
    }
    return setores
  },
  atualizar: atualizarSetoresBrapi,
}
