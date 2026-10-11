import { DEFAULT_TESOURO_API_URL } from '@/domain/configuracoes'
import { toISO } from '@/lib/dates'
import { parseDecimalBR, toCentavos } from '@/lib/money'
import { clearStorageKeys, readStorageJson, writeStorageJson } from '@/lib/storage'

/**
 * Cotação de **Tesouro Direto** via API de dados abertos (Tesouro Nacional),
 * com **fallback para preço manual** (RF19).
 *
 * Esta é uma das portas de saída de rede mapeadas na skill
 * `integracao-google-sheets`. Estratégia:
 * - Cache local (RNF02) com validade (TTL); leitura do cache primeiro.
 * - Uma única requisição por refresh (lista completa), cotações casadas por
 *   título/ano.
 * - **Qualquer falha** (rede, CORS, quota, formato inesperado) resulta em
 *   "sem cotação" — o app usa o preço manual/médio e nunca trava a UI (RNF04).
 */

/** Tempo máximo de espera pela API antes de desistir (fallback manual). */
const REQUEST_TIMEOUT_MS = 8000

/** Validade do cache de cotação do Tesouro (o Tesouro publica 1× ao dia). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const CACHE_PREFIX = 'minhaacoes.tesouro.v1.'

/** Opções da busca de cotações do Tesouro Direto. */
export interface BuscarTesouroOptions {
  /** Endpoint configurado pelo usuário (vazio = `DEFAULT_TESOURO_API_URL`). */
  apiUrl?: string
}

/** Endpoint efetivo: o configurado pelo usuário quando informado; senão o padrão. */
function resolverApiUrl(apiUrl?: string): string {
  const valor = typeof apiUrl === 'string' ? apiUrl.trim() : ''
  return valor.length > 0 ? valor : DEFAULT_TESOURO_API_URL
}

/** Cotação de um título do Tesouro. */
export interface TesouroCotacao {
  /** Preço unitário (PU) em **centavos**. */
  preco: number
  /** ISO da data-base da cotação (`null` quando desconhecida). */
  atualizadoEm: string | null
  fonte: 'api' | 'cache'
}

/** Registro normalizado extraído da resposta da API. */
export interface TesouroRegistro {
  tipoTitulo: string
  /** ISO `YYYY-MM-DD`. */
  dataVencimento: string | null
  /** ISO `YYYY-MM-DD`. */
  dataBase: string | null
  /** PU em **centavos** (`null` quando ausente/inválido). */
  precoCentavos: number | null
}

/** Normaliza texto (remove acentos, pontuação e caixa) para casar títulos. */
function normalizar(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Converte `DD/MM/AAAA` ou `AAAA-MM-DD` em ISO. Retorna `null` se inválido. */
function paraISO(value: unknown): string | null {
  if (value instanceof Date) return toISO(value)
  if (typeof value !== 'string') return null
  const texto = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10)
  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  return null
}

function lerTexto(registro: Record<string, unknown>, chaves: readonly string[]): string | null {
  for (const chave of chaves) {
    const valor = registro[chave]
    if (typeof valor === 'string' && valor.trim().length > 0) return valor.trim()
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor)
  }
  return null
}

function lerCentavos(registro: Record<string, unknown>, chaves: readonly string[]): number | null {
  for (const chave of chaves) {
    const valor = registro[chave]
    if (typeof valor === 'number' && Number.isFinite(valor)) return toCentavos(valor)
    if (typeof valor === 'string') {
      const parsed = parseDecimalBR(valor)
      if (parsed !== null && parsed > 0) return toCentavos(parsed)
    }
  }
  return null
}

const CHAVES_TITULO = ['Tipo Titulo', 'TipoTitulo', 'Tipo_Titulo', 'titulo', 'Título'] as const
const CHAVES_VENCIMENTO = ['Data Vencimento', 'DataVencimento', 'Vencimento'] as const
const CHAVES_DATA_BASE = ['Data Base', 'DataBase', 'Data_Base'] as const
const CHAVES_PRECO = [
  'PU Venda Manha',
  'PU Compra Manha',
  'PU Base Manha',
  'Preco Unitario',
  'Preço Unitário',
  'PU',
] as const

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extrai os registros de cotação de uma resposta CKAN
 * (`{ result: { records: [...] } }`). Entradas inesperadas são ignoradas.
 */
export function extrairRegistros(payload: unknown): TesouroRegistro[] {
  if (!isRegistro(payload)) return []
  const result = payload.result
  if (!isRegistro(result)) return []
  const records = result.records
  if (!Array.isArray(records)) return []

  const registros: TesouroRegistro[] = []
  for (const item of records) {
    if (!isRegistro(item)) continue
    const tipoTitulo = lerTexto(item, CHAVES_TITULO)
    if (!tipoTitulo) continue
    registros.push({
      tipoTitulo,
      dataVencimento: paraISO(lerTexto(item, CHAVES_VENCIMENTO)),
      dataBase: paraISO(lerTexto(item, CHAVES_DATA_BASE)),
      precoCentavos: lerCentavos(item, CHAVES_PRECO),
    })
  }
  return registros
}

/** `true` quando o registro casa com o ticker informado (título + ano). */
function registroCasa(registro: TesouroRegistro, ticker: string): boolean {
  const titulo = normalizar(registro.tipoTitulo)
  if (titulo.length === 0) return false

  const alvo = normalizar(ticker)
  if (alvo.length > 0 && titulo.includes(alvo)) return true

  const tokens = ticker
    .split(/[^a-zA-Z0-9]+/)
    .map(normalizar)
    .filter((token) => token.length >= 3)
  if (tokens.length === 0) return false
  return tokens.every((token) => titulo.includes(token))
}

/**
 * Encontra a cotação de um ticker nos registros extraídos, escolhendo a
 * data-base mais recente. Retorna `null` quando não há correspondência.
 */
export function encontrarCotacao(
  registros: readonly TesouroRegistro[],
  ticker: string,
): TesouroCotacao | null {
  const candidatos = registros.filter(
    (registro) => registro.precoCentavos !== null && registroCasa(registro, ticker),
  )
  if (candidatos.length === 0) return null

  const melhor = candidatos.reduce((atual, registro) => {
    const dataAtual = atual.dataBase ?? ''
    const dataNovo = registro.dataBase ?? ''
    return dataNovo >= dataAtual ? registro : atual
  })

  return {
    preco: melhor.precoCentavos ?? 0,
    atualizadoEm: melhor.dataBase,
    fonte: 'api',
  }
}

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`
}

function lerCache(ticker: string): { valor: TesouroCotacao; gravadoEm: number } | null {
  const registro = readStorageJson<{ cotacao: TesouroCotacao; gravadoEm: number }>(
    cacheKey(ticker),
  )
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  return { valor: registro.cotacao, gravadoEm: registro.gravadoEm }
}

function gravarCache(ticker: string, cotacao: TesouroCotacao): void {
  writeStorageJson(cacheKey(ticker), { cotacao, gravadoEm: Date.now() })
}

/** Lê a cotação do cache local, quando ainda válida. */
export function lerCotacaoCache(ticker: string): TesouroCotacao | null {
  const registro = lerCache(ticker)
  if (!registro) return null
  if (Date.now() - registro.gravadoEm > CACHE_TTL_MS) return null
  return { ...registro.valor, fonte: 'cache' }
}

/**
 * Busca as cotações do Tesouro para os tickers informados (cache-first).
 * Nunca lança: em caso de falha retorna apenas o que estiver disponível.
 *
 * O endpoint é resolvido por `options.apiUrl` (config do usuário na planilha);
 * quando vazio, usa o endpoint público padrão.
 */
export async function buscarCotacoesTesouro(
  tickers: readonly string[],
  options: BuscarTesouroOptions = {},
): Promise<Map<string, TesouroCotacao>> {
  const resultado = new Map<string, TesouroCotacao>()
  const pendentes: string[] = []

  for (const ticker of tickers) {
    const normalizado = ticker.trim()
    if (normalizado.length === 0 || resultado.has(normalizado)) continue
    const cache = lerCotacaoCache(normalizado)
    if (cache) resultado.set(normalizado, cache)
    else pendentes.push(normalizado)
  }

  if (pendentes.length === 0) return resultado
  if (typeof fetch !== 'function') return resultado

  const registros = await buscarRegistros(resolverApiUrl(options.apiUrl))
  if (registros.length === 0) return resultado

  for (const ticker of pendentes) {
    const cotacao = encontrarCotacao(registros, ticker)
    if (!cotacao) continue
    gravarCache(ticker, cotacao)
    resultado.set(ticker, cotacao)
  }

  return resultado
}

/** Remove as cotações do Tesouro do cache local (ex.: após mudar o endpoint). */
export function clearTesouroCache(): void {
  clearStorageKeys(CACHE_PREFIX)
}

/** Busca (best-effort) os registros da API. Falhas retornam `[]`. */
async function buscarRegistros(apiUrl: string): Promise<TesouroRegistro[]> {
  if (typeof AbortController !== 'function') return []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return []
    const payload: unknown = await response.json()
    return extrairRegistros(payload)
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}
