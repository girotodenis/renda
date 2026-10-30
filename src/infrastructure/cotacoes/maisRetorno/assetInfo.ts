import type {
  OpcoesConsultaCotacoes,
  ProvedorSetores,
  ResultadoSetores,
} from '@/domain/provedoresCotacao'
import { identificadorB3 } from '@/infrastructure/cotacoes/maisRetorno/cotacoesB3'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Setor de atuação de **B3 (Ação/FII/BDR/ETF)** via Mais Retorno
 * (`/asset-info/{identifier}`), fallback da cadeia de setores.
 *
 * Estratégia:
 * - Endpoint autenticado por `X-Api-Key` (CORS liberado).
 * - **1 crédito por chamada**: uma requisição por ticker, sempre cache-first
 *   com TTL longo (dado cadastral quase não muda).
 * - A resposta é **cadastral** e o formato varia por tipo de ativo, então a
 *   leitura é tolerante: procura `sector`/`setor`, depois `segment`/`segmento`
 *   e por fim `industry`/`industria`, no objeto raiz ou em contêineres comuns
 *   (`data`, `asset`, `info`, `result`).
 * - **Qualquer falha** (rede, token ausente, 401/403/429, formato inesperado)
 *   resulta em "sem setor" — o ativo é omitido do gráfico.
 */

/** Base URL da Market Data API (v4). */
const BASE_URL = 'https://data.maisretorno.com/mr-data/v4/api'

/** Tempo máximo de espera pela API antes de desistir. */
const REQUEST_TIMEOUT_MS = 10000

/** Dado cadastral: 30 dias de cache evitam gastar crédito à toa. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const CACHE_PREFIX = 'minhaacoes.maisRetornoSetor.v1.'

/** Chaves aceitas, em ordem de preferência (setor → segmento → indústria). */
const CHAVES_SETOR: readonly (readonly string[])[] = [
  ['sector', 'setor'],
  ['segment', 'segmento'],
  ['industry', 'industria'],
]

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normaliza o nome da chave para comparação tolerante (caixa/acento/separador). */
function normalizarChave(chave: string): string {
  return chave
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase()
}

/** Texto de um valor (aceita string ou objeto com `name`/`nome`). */
function valorTexto(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (isRegistro(value)) {
    const nome = value.name ?? value.nome
    return typeof nome === 'string' ? nome.trim() : ''
  }
  return ''
}

/** Procura uma das chaves (na ordem) dentro de um objeto, tolerante ao nome. */
function buscarChave(container: Record<string, unknown>, chaves: readonly string[]): string {
  const alvos = new Set(chaves.map(normalizarChave))
  for (const [chave, valor] of Object.entries(container)) {
    if (!alvos.has(normalizarChave(chave))) continue
    const texto = valorTexto(valor)
    if (texto.length > 0) return texto
  }
  return ''
}

/**
 * Extrai o setor de atuação da resposta de `/asset-info`
 * (`{ sector }`, `{ data: { sector } }`, `{ sector: { name } }`, ...).
 * Devolve `null` quando nenhum campo conhecido traz texto.
 */
export function extrairSetor(payload: unknown): string | null {
  if (!isRegistro(payload) || payload.error === true) return null

  const containers: Record<string, unknown>[] = [payload]
  for (const chave of ['data', 'asset', 'info', 'result', 'results']) {
    const valor = payload[chave]
    if (isRegistro(valor)) containers.push(valor)
    else if (Array.isArray(valor) && isRegistro(valor[0])) containers.push(valor[0])
  }

  for (const chaves of CHAVES_SETOR) {
    for (const container of containers) {
      const setor = buscarChave(container, chaves)
      if (setor.length > 0) return setor
    }
  }
  return null
}

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`
}

/** Lê o setor do cache local, quando ainda válido. */
export function lerSetorCache(ticker: string): string | null {
  const registro = readStorageJson<{ setor: string; gravadoEm: number }>(cacheKey(ticker))
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  const setor = typeof registro.setor === 'string' ? registro.setor.trim() : ''
  return setor.length > 0 ? setor : null
}

function gravarCache(ticker: string, setor: string): void {
  writeStorageJson(cacheKey(ticker), { setor, gravadoEm: Date.now() })
}

/** Remove os setores do cache local (ex.: após trocar a api-key). */
export function clearMaisRetornoSetorCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Busca (best-effort) o setor de um único ticker. Falhas retornam `null`. */
async function buscarSetor(ticker: string, token: string): Promise<string | null> {
  if (typeof AbortController !== 'function' || typeof fetch !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = `${BASE_URL}/asset-info/${encodeURIComponent(identificadorB3(ticker))}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Api-Key': token },
    })
    if (!response.ok) return null
    return extrairSetor(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Consulta os setores via Mais Retorno (cache-first, um ticker por chamada).
 * Nunca lança: devolve o que foi possível obter e o que faltou.
 */
export async function atualizarSetoresMaisRetorno(
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

  const token = (opcoes.tokens.maisretorno ?? '').trim()
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

/** Porta de setores da Mais Retorno (usada na cadeia de integrações). */
export const provedorSetoresMaisRetorno: ProvedorSetores = {
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
  atualizar: atualizarSetoresMaisRetorno,
}
