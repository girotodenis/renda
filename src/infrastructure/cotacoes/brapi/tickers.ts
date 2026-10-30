import { CategoriaAtivo } from '@/domain/entities'
import { readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Lista de tickers da B3 via Brapi (`/api/quote/list`), para o autocomplete do
 * cadastro de operações.
 *
 * - **Não usa token**: o endpoint é público; o autocomplete funciona mesmo sem
 *   a Brapi configurada.
 * - Uma requisição por tipo (`stock`, `fund`, `bdr`) traz a lista completa;
 *   o filtro por texto é local.
 * - Cache longo no `LocalStorage` (a lista muda pouco). Se a rede falhar, usa o
 *   cache vencido; sem cache, devolve lista vazia. **Nunca lança.**
 */

const BRAPI_LIST_URL = 'https://brapi.dev/api/quote/list'
const REQUEST_TIMEOUT_MS = 10000
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_PREFIX = 'minhaacoes.brapiTickers.v2.'
const LIMITE = 5000

type TipoBrapi = 'stock' | 'fund' | 'bdr'

const TIPO_POR_CATEGORIA: Partial<Record<CategoriaAtivo, TipoBrapi>> = {
  [CategoriaAtivo.Acao]: 'stock',
  [CategoriaAtivo.Fii]: 'fund',
  [CategoriaAtivo.Etf]: 'fund',
  [CategoriaAtivo.Bdr]: 'bdr',
}

interface CacheTickers {
  porCategoria: Partial<Record<CategoriaAtivo, string[]>>
  gravadoEm: number
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Categoria do app a partir de `type`/`subType` da Brapi (`null` = desconhecida). */
function categoriaDoItem(type: unknown, subType: unknown): CategoriaAtivo | null {
  if (type === 'stock') return CategoriaAtivo.Acao
  if (type === 'bdr') return CategoriaAtivo.Bdr
  if (type === 'fund') return subType === 'etf' ? CategoriaAtivo.Etf : CategoriaAtivo.Fii
  return null
}

/**
 * Extrai os códigos por categoria da resposta de `/api/quote/list`
 * (`{ stocks: [{ stock, type, subType }] }`). FII/Fiagro/FI-Infra/FIP vão para
 * `Fii`; `subType: 'etf'` vai para `Etf`. Itens inválidos e códigos do
 * mercado fracionário são ignorados.
 */
export function extrairTickersBrapi(payload: unknown): Map<CategoriaAtivo, string[]> {
  const resultado = new Map<CategoriaAtivo, string[]>()
  if (!isRegistro(payload) || payload.error === true || !Array.isArray(payload.stocks)) {
    return resultado
  }
  for (const item of payload.stocks) {
    if (!isRegistro(item)) continue
    const codigo = typeof item.stock === 'string' ? item.stock.trim().toUpperCase() : ''
    const categoria = categoriaDoItem(item.type, item.subType)
    // Códigos do mercado fracionário (`PETR4F`) agregam no lote padrão: não são sugeridos.
    if (codigo.length === 0 || !categoria || /\dF$/.test(codigo)) continue
    const lista = resultado.get(categoria)
    if (lista) lista.push(codigo)
    else resultado.set(categoria, [codigo])
  }
  return resultado
}

function cacheKey(tipo: TipoBrapi): string {
  return `${CACHE_PREFIX}${tipo}`
}

function lerCache(tipo: TipoBrapi): CacheTickers | null {
  const registro = readStorageJson<CacheTickers>(cacheKey(tipo))
  if (!registro || typeof registro.gravadoEm !== 'number' || !isRegistro(registro.porCategoria)) {
    return null
  }
  return registro
}

async function baixarTipo(tipo: TipoBrapi): Promise<CacheTickers | null> {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = `${BRAPI_LIST_URL}?type=${tipo}&limit=${LIMITE}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const porCategoria = Object.fromEntries(extrairTickersBrapi(await response.json()))
    if (Object.keys(porCategoria).length === 0) return null
    const registro: CacheTickers = { porCategoria, gravadoEm: Date.now() }
    writeStorageJson(cacheKey(tipo), registro)
    return registro
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const emAndamento = new Map<TipoBrapi, Promise<CacheTickers | null>>()

/**
 * Tickers B3 da categoria (Ação, FII, BDR ou ETF). Outras categorias → `[]`.
 * Cache-first; requisições simultâneas do mesmo tipo são compartilhadas.
 */
export async function listarTickersBrapi(categoria: CategoriaAtivo): Promise<string[]> {
  const tipo = TIPO_POR_CATEGORIA[categoria]
  if (!tipo) return []

  const cache = lerCache(tipo)
  if (cache && Date.now() - cache.gravadoEm <= CACHE_TTL_MS) {
    return cache.porCategoria[categoria] ?? []
  }

  let pendente = emAndamento.get(tipo)
  if (!pendente) {
    pendente = baixarTipo(tipo).finally(() => emAndamento.delete(tipo))
    emAndamento.set(tipo, pendente)
  }
  const atualizado = (await pendente) ?? cache
  return atualizado?.porCategoria[categoria] ?? []
}
