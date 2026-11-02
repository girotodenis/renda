/**
 * Primitivas de rede da **planilha de cotações** (Sheets API v4 + Drive).
 *
 * A planilha é derivada e descartável: só guarda tickers e as fórmulas do
 * `GOOGLEFINANCE`. Este módulo transporta JSON e metadados — nenhuma regra de
 * reconciliação mora aqui (ver `planilhaGoogle/planilha.ts`).
 *
 * Falhas viram `PlanilhaCotacoesError` (com o `status` HTTP e o `motivo`
 * devolvido pelo Google), para que a integração degrade para as APIs sem
 * lançar nada ao chamador (contrato da porta `IntegracaoCotacao`).
 */

/** Endpoint da Sheets API v4 (criação, metadados, leitura e escrita). */
export const SHEETS_API_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Endpoint de arquivos do Drive (usado só para descobrir a planilha). */
export const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'

export const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'

/** Título fixo da planilha criada pelo app. */
export const TITULO_PLANILHA_COTACOES = 'Minhas Ações — Cotações'

/** Aba única da planilha de cotações. */
export const ABA_COTACOES = 'Cotações'

const REQUEST_TIMEOUT_MS = 15_000

/** Erro originado das APIs do Google usadas pela planilha de cotações. */
export class PlanilhaCotacoesError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** `error.status` devolvido pelo Google (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`, ...). */
    public readonly motivo: string | null = null,
  ) {
    super(message)
    this.name = 'PlanilhaCotacoesError'
  }
}

/** `true` quando a falha é de permissão/escopo insuficiente (HTTP 403). */
export function isEscopoInsuficiente(error: unknown): boolean {
  if (!(error instanceof PlanilhaCotacoesError) || error.status !== 403) return false
  return (
    error.motivo === null ||
    error.motivo === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
    error.motivo === 'PERMISSION_DENIED'
  )
}

/** `true` quando a planilha (ou a aba) não existe mais (HTTP 404). */
export function isNaoEncontrada(error: unknown): boolean {
  return error instanceof PlanilhaCotacoesError && error.status === 404
}

let requestCount = 0

/** Quantas requisições HTTP já foram feitas a este módulo (diagnóstico). */
export function getPlanilhaRequestCount(): number {
  return requestCount
}

/** Zera o contador de requisições (diagnóstico e testes). */
export function resetPlanilhaRequestCount(): void {
  requestCount = 0
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

function jsonAuthHeaders(token: string): Record<string, string> {
  return { ...authHeaders(token), 'Content-Type': 'application/json' }
}

/** Mensagem em pt-BR para uma falha HTTP da planilha. */
function mensagemPara(status: number): string {
  if (status === 401) return 'Sessão expirada. Faça login novamente.'
  if (status === 403) return 'Sem permissão para acessar a planilha de cotações.'
  if (status === 404) return 'Planilha de cotações não encontrada.'
  if (status === 429) return 'Cota da API do Google excedida. Tente novamente em instantes.'
  return `Falha na API do Google (HTTP ${status}).`
}

/** Converte uma resposta de erro em `PlanilhaCotacoesError` (com o motivo do Google). */
async function toPlanilhaError(response: Response): Promise<PlanilhaCotacoesError> {
  let motivo: string | null = null
  try {
    const payload = (await response.json()) as { error?: { status?: unknown } }
    const status = payload?.error?.status
    if (typeof status === 'string') motivo = status
  } catch {
    // Corpo sem JSON: fica só o status HTTP.
  }
  return new PlanilhaCotacoesError(response.status, mensagemPara(response.status), motivo)
}

/**
 * Executa um `fetch` autenticado com timeout e devolve o JSON da resposta.
 *
 * Falha de rede/timeout vira `status === 0`, para que a integração marque o
 * estado como `indisponivel` sem propagar exceção.
 */
async function planilhaRequest(url: string, init: RequestInit): Promise<unknown> {
  if (typeof fetch !== 'function') {
    throw new PlanilhaCotacoesError(0, 'Rede indisponível para acessar a planilha de cotações.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  requestCount += 1
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw await toPlanilhaError(response)
    if (typeof response.json !== 'function') return null
    return await response.json().catch(() => null)
  } catch (error) {
    if (error instanceof PlanilhaCotacoesError) throw error
    throw new PlanilhaCotacoesError(0, 'Falha de rede ao acessar a planilha de cotações.')
  } finally {
    clearTimeout(timer)
  }
}

/** Aba da planilha (título + `sheetId` usado pelo `batchUpdate`). */
export interface AbaPlanilha {
  titulo: string
  sheetId: number | null
}

/** Metadados mínimos da planilha (o locale define o separador das fórmulas). */
export interface MetadadosPlanilha {
  locale: string | null
  abas: AbaPlanilha[]
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Converte a resposta de `values.get` em matriz de linhas. */
function parseValores(payload: unknown): unknown[][] {
  const values = isRegistro(payload) ? payload.values : null
  if (!Array.isArray(values)) return []
  return values.filter((linha): linha is unknown[] => Array.isArray(linha))
}

/** Cria a planilha de cotações com a aba única `Cotações`. */
export async function criarPlanilhaCotacoes(token: string): Promise<{ spreadsheetId: string }> {
  const payload = await planilhaRequest(SHEETS_API_ENDPOINT, {
    method: 'POST',
    headers: jsonAuthHeaders(token),
    body: JSON.stringify({
      properties: { title: TITULO_PLANILHA_COTACOES },
      sheets: [{ properties: { title: ABA_COTACOES } }],
    }),
  })
  const spreadsheetId = isRegistro(payload) ? payload.spreadsheetId : null
  if (typeof spreadsheetId !== 'string' || spreadsheetId.length === 0) {
    throw new PlanilhaCotacoesError(
      0,
      'O Google não devolveu o identificador da planilha de cotações criada.',
    )
  }
  return { spreadsheetId }
}

/** Escapa um valor para uso seguro dentro de uma consulta do Drive (`q`). */
function escaparConsultaDrive(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Descobre a planilha de cotações já criada pelo app.
 *
 * O escopo `drive.file` limita a listagem aos arquivos que o próprio app criou,
 * então filtrar por título + MIME é suficiente. Devolve a mais recente.
 */
export async function descobrirPlanilhaCotacoes(token: string): Promise<string | null> {
  const query = [
    `name = '${escaparConsultaDrive(TITULO_PLANILHA_COTACOES)}'`,
    `mimeType = '${SPREADSHEET_MIME_TYPE}'`,
    'trashed = false',
  ].join(' and ')
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '10',
  })
  const payload = await planilhaRequest(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: authHeaders(token),
  })
  const files = isRegistro(payload) && Array.isArray(payload.files) ? payload.files : []
  const candidatos = files
    .filter(isRegistro)
    .map((file) => ({
      id: typeof file.id === 'string' ? file.id : '',
      modificadoEm: typeof file.modifiedTime === 'string' ? Date.parse(file.modifiedTime) : NaN,
    }))
    .filter((file) => file.id.length > 0)
  if (candidatos.length === 0) return null
  const recentes = candidatos.filter((file) => !Number.isNaN(file.modificadoEm))
  if (recentes.length === 0) return candidatos[0].id
  recentes.sort((a, b) => b.modificadoEm - a.modificadoEm)
  return recentes[0].id
}

/** Lê os valores de um intervalo (ex.: `Cotações!A2:D`). */
export async function lerValores(
  token: string,
  spreadsheetId: string,
  range: string,
): Promise<unknown[][]> {
  const url = `${SHEETS_API_ENDPOINT}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  return parseValores(await planilhaRequest(url, { headers: authHeaders(token) }))
}

/** Grava valores/fórmulas com `USER_ENTERED` (o Sheets interpreta as fórmulas). */
export async function escreverValores(
  token: string,
  spreadsheetId: string,
  range: string,
  values: readonly (readonly unknown[])[],
): Promise<void> {
  const url =
    `${SHEETS_API_ENDPOINT}/${encodeURIComponent(spreadsheetId)}/values/` +
    `${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`
  await planilhaRequest(url, {
    method: 'PUT',
    headers: jsonAuthHeaders(token),
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  })
}

/** Apaga os valores de um intervalo (usado antes de regravar os tickers). */
export async function limparValores(
  token: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  const url =
    `${SHEETS_API_ENDPOINT}/${encodeURIComponent(spreadsheetId)}/values/` +
    `${encodeURIComponent(range)}:clear`
  await planilhaRequest(url, {
    method: 'POST',
    headers: jsonAuthHeaders(token),
    body: JSON.stringify({}),
  })
}

/** Lê os metadados da planilha (locale + abas). */
export async function lerMetadados(
  token: string,
  spreadsheetId: string,
): Promise<MetadadosPlanilha> {
  const url =
    `${SHEETS_API_ENDPOINT}/${encodeURIComponent(spreadsheetId)}` +
    '?fields=properties.locale,sheets.properties.sheetId,sheets.properties.title'
  const payload = await planilhaRequest(url, { headers: authHeaders(token) })
  const properties =
    isRegistro(payload) && isRegistro(payload.properties) ? payload.properties : {}
  const locale = typeof properties.locale === 'string' ? properties.locale : null
  const sheets = isRegistro(payload) && Array.isArray(payload.sheets) ? payload.sheets : []
  const abas: AbaPlanilha[] = []
  for (const sheet of sheets) {
    if (!isRegistro(sheet) || !isRegistro(sheet.properties)) continue
    const titulo = sheet.properties.title
    if (typeof titulo !== 'string') continue
    const sheetId = sheet.properties.sheetId
    abas.push({ titulo, sheetId: typeof sheetId === 'number' ? sheetId : null })
  }
  return { locale, abas }
}

/**
 * Garante que a aba exista (cria com `batchUpdate` quando faltar) e devolve os
 * metadados da planilha — o locale é o que define o separador das fórmulas.
 */
export async function garantirAba(
  token: string,
  spreadsheetId: string,
  titulo: string,
  metadados?: MetadadosPlanilha,
): Promise<MetadadosPlanilha> {
  const atual = metadados ?? (await lerMetadados(token, spreadsheetId))
  if (atual.abas.some((aba) => aba.titulo === titulo)) return atual

  const payload = await planilhaRequest(
    `${SHEETS_API_ENDPOINT}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: titulo } } }] }),
    },
  )
  const replies = isRegistro(payload) && Array.isArray(payload.replies) ? payload.replies : []
  const primeira = replies[0]
  const properties =
    isRegistro(primeira) &&
    isRegistro(primeira.addSheet) &&
    isRegistro(primeira.addSheet.properties)
      ? primeira.addSheet.properties
      : {}
  const sheetId = typeof properties.sheetId === 'number' ? properties.sheetId : null

  return { locale: atual.locale, abas: [...atual.abas, { titulo, sheetId }] }
}
