/**
 * Primitivas de rede do arquivo do banco de dados no Google Drive.
 *
 * O banco da carteira é UM arquivo JSON compactado (gzip) no Drive, acessado
 * apenas com o escopo `drive.file`. Este módulo transporta bytes e metadados —
 * nenhuma regra de dados/abas mora aqui (ver `driveFile/format.ts` e
 * `driveFile/gateway.ts`).
 */

export const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files'
export const DATABASE_MIME_TYPE = 'application/gzip'
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

const NETWORK_ERROR_MESSAGE =
  'Falha de rede ao acessar o Google Drive. Verifique sua conexão.'
const TIMEOUT_ERROR_MESSAGE =
  'Tempo limite ao acessar o Google Drive. A alteração ficará na fila e será reenviada.'

/** Erro originado da API de arquivos do Drive. */
export class GoogleDriveFileError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleDriveFileError'
  }

  /** true quando é conflito de versão (HTTP 412). */
  get isConflict(): boolean {
    return this.status === 412
  }
}

export interface DriveDatabaseFile {
  fileId: string
  name: string
  etag: string | null
  /** ISO do último modificado (preenchido pelas listagens). */
  modifiedTime?: string | null
}

export interface ReadDatabaseFileResult {
  bytes: Uint8Array
  /** Pode ser null quando o navegador não expõe o header ETag (CORS). */
  etag: string | null
  name: string | null
}

/** Opções aceitas pelas primitivas (o timeout curto é usado nos testes). */
export interface DriveFileRequestOptions {
  timeoutMs?: number
}

interface DriveFileMetadata {
  id?: unknown
  name?: unknown
}

interface DriveFileListResponse {
  files?: { id?: unknown; name?: unknown; modifiedTime?: unknown }[]
}

let requestCount = 0

/** Quantas requisições HTTP já foram feitas a este módulo (diagnóstico). */
export function getDriveFileRequestCount(): number {
  return requestCount
}

/** Zera o contador de requisições (diagnóstico). */
export function resetDriveFileRequestCount(): void {
  requestCount = 0
}

/** Escapa um valor para uso seguro dentro de uma consulta do Drive (`q`). */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Converte um status HTTP de falha em `GoogleDriveFileError` (pt-BR). */
function toDriveFileError(status: number): GoogleDriveFileError {
  if (status === 401) {
    return new GoogleDriveFileError(401, 'Sessão expirada. Faça login novamente.')
  }
  if (status === 403) {
    return new GoogleDriveFileError(
      403,
      'Permissão negada pelo Google Drive. Verifique se a API Drive está habilitada e se o escopo drive.file foi autorizado.',
    )
  }
  if (status === 404) {
    return new GoogleDriveFileError(404, 'Arquivo do banco de dados não encontrado no Google Drive.')
  }
  if (status === 412) {
    return new GoogleDriveFileError(
      412,
      'O banco de dados foi alterado em outro dispositivo. Recarregue e tente novamente.',
    )
  }
  if (status === 429) {
    return new GoogleDriveFileError(429, 'Cota da API do Google excedida. Tente novamente em instantes.')
  }
  return new GoogleDriveFileError(status, `Falha na API do Google Drive (HTTP ${status}).`)
}

/** Normaliza o header `ETag` (remove `W/` e as aspas). */
function normalizeEtag(raw: string | null): string | null {
  if (raw === null) return null
  let value = raw.trim()
  if (value.startsWith('W/')) value = value.slice(2)
  value = value.replace(/"/g, '').trim()
  return value.length > 0 ? value : null
}

/** Lê o `ETag` da resposta; `null` quando o header não está exposto. */
function readEtag(response: Response): string | null {
  const header = response.headers.get('ETag')
  return normalizeEtag(header)
}

/**
 * Executa um `fetch` autenticado com timeout obrigatório.
 *
 * Falha de rede/`AbortError` e timeout viram `status === 0` (o outbox trata
 * esse status como "offline" e mantém a alteração na fila).
 */
async function driveRequest(
  url: string,
  init: RequestInit,
  options?: DriveFileRequestOptions,
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new GoogleDriveFileError(0, TIMEOUT_ERROR_MESSAGE))
    }, timeoutMs)
  })

  requestCount += 1
  try {
    const pending = fetch(url, { ...init, signal: controller.signal })
    // Evita "unhandled rejection" quando o timeout vence a corrida.
    pending.catch(() => undefined)
    const response = await Promise.race([pending, timeout])
    if (!response.ok) throw toDriveFileError(response.status)
    return response
  } catch (error) {
    if (error instanceof GoogleDriveFileError) throw error
    // O abort do nosso próprio timeout pode rejeitar o `fetch` antes da corrida.
    if (timedOut) throw new GoogleDriveFileError(0, TIMEOUT_ERROR_MESSAGE)
    throw new GoogleDriveFileError(0, NETWORK_ERROR_MESSAGE)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Converte os bytes em corpo aceito pelo `fetch` (sem copiar quando possível). */
function toRequestBody(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer
  }
  return bytes.slice().buffer as ArrayBuffer
}

/** Cria o arquivo vazio do banco e envia o conteúdo inicial. */
export async function createDatabaseFile(
  accessToken: string,
  name: string,
  bytes: Uint8Array,
  options?: DriveFileRequestOptions,
): Promise<DriveDatabaseFile> {
  const created = await driveRequest(
    `${DRIVE_FILES_ENDPOINT}?fields=id,name`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, mimeType: DATABASE_MIME_TYPE }),
    },
    options,
  )
  const metadata = (await created.json()) as DriveFileMetadata
  const fileId = typeof metadata.id === 'string' ? metadata.id : ''
  if (fileId.length === 0) {
    throw new GoogleDriveFileError(
      0,
      'O Google Drive não devolveu o identificador do arquivo criado.',
    )
  }

  const uploaded = await driveRequest(
    `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': DATABASE_MIME_TYPE,
      },
      body: toRequestBody(bytes),
    },
    options,
  )

  const resolvedName =
    typeof metadata.name === 'string' && metadata.name.length > 0 ? metadata.name : name
  return {
    fileId,
    name: resolvedName,
    etag: readEtag(uploaded) ?? readEtag(created),
  }
}

/** Lê os metadados (etag/título) e os bytes do arquivo do banco. */
export async function readDatabaseFile(
  accessToken: string,
  fileId: string,
  options?: DriveFileRequestOptions,
): Promise<ReadDatabaseFileResult> {
  const encodedId = encodeURIComponent(fileId)
  const metadataResponse = await driveRequest(
    `${DRIVE_FILES_ENDPOINT}/${encodedId}?fields=id,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    options,
  )
  const metadata = (await metadataResponse.json()) as DriveFileMetadata

  const mediaResponse = await driveRequest(
    `${DRIVE_FILES_ENDPOINT}/${encodedId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    options,
  )

  return {
    bytes: new Uint8Array(await mediaResponse.arrayBuffer()),
    etag: readEtag(metadataResponse),
    name: typeof metadata.name === 'string' ? metadata.name : null,
  }
}

/** Substitui o conteúdo do arquivo e devolve o novo etag (controle de versão). */
export async function writeDatabaseFile(
  accessToken: string,
  fileId: string,
  bytes: Uint8Array,
  etag?: string | null,
  options?: DriveFileRequestOptions,
): Promise<{ etag: string | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': DATABASE_MIME_TYPE,
  }
  if (typeof etag === 'string' && etag.trim().length > 0) {
    headers['If-Match'] = etag.trim()
  }

  const response = await driveRequest(
    `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`,
    { method: 'PATCH', headers, body: toRequestBody(bytes) },
    options,
  )

  return { etag: readEtag(response) }
}

/** Sufixo do arquivo do banco usado nas consultas de listagem. */
const DATABASE_NAME_FILTER = '.json.gz'

/** Máximo de bancos devolvidos pelas listagens (o app cria poucos). */
const MAX_LISTED_FILES = 50

/** Converte a resposta de `files.list` no tipo público (ignora itens inválidos). */
function parseFileList(body: DriveFileListResponse): DriveDatabaseFile[] {
  const found: DriveDatabaseFile[] = []
  for (const file of body.files ?? []) {
    if (typeof file.id === 'string' && typeof file.name === 'string') {
      found.push({
        fileId: file.id,
        name: file.name,
        etag: null,
        modifiedTime: typeof file.modifiedTime === 'string' ? file.modifiedTime : null,
      })
    }
  }
  return found
}

/** Ordena do mais recente para o mais antigo (a API nem sempre ordena). */
function sortByRecency(files: DriveDatabaseFile[]): DriveDatabaseFile[] {
  return files.slice().sort((a, b) => {
    const da = Date.parse(a.modifiedTime ?? '')
    const db = Date.parse(b.modifiedTime ?? '')
    if (Number.isNaN(da) && Number.isNaN(db)) return 0
    if (Number.isNaN(da)) return 1
    if (Number.isNaN(db)) return -1
    return db - da
  })
}

/**
 * Executa `files.list` com os parâmetros informados.
 *
 * A listagem filtra **pelo nome** (`*.json.gz`) em vez de `mimeType`: o Drive
 * pode reclassificar o arquivo enviado por `uploadType=media` (o MIME não é
 * garantido), e o escopo `drive.file` já limita a listagem aos arquivos que o
 * app criou. `orderBy` é evitado porque nem toda combinação de `q` + `orderBy` é
 * aceita; a ordenação é feita no cliente.
 */
async function listFiles(
  accessToken: string,
  query: string,
  pageSize: number,
  options?: DriveFileRequestOptions,
): Promise<DriveDatabaseFile[]> {
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,modifiedTime)',
    pageSize: String(pageSize),
  })

  const response = await driveRequest(
    `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    options,
  )

  return sortByRecency(parseFileList((await response.json()) as DriveFileListResponse))
}

/** Lista os arquivos do banco com exatamente `name` (detecção de duplicidade). */
export async function listDatabaseFiles(
  accessToken: string,
  name: string,
  options?: DriveFileRequestOptions,
): Promise<DriveDatabaseFile[]> {
  const trimmed = name.trim()
  if (trimmed.length === 0) return []

  const query = [`name = '${escapeDriveQueryValue(trimmed)}'`, 'trashed = false'].join(' and ')
  return listFiles(accessToken, query, 10, options)
}

/**
 * Lista todos os bancos que o app já criou no Drive, do mais recente para o mais
 * antigo — usado na lista de "abrir banco existente".
 */
export async function listAllDatabaseFiles(
  accessToken: string,
  options?: DriveFileRequestOptions,
): Promise<DriveDatabaseFile[]> {
  const query = [`trashed = false`, `name contains '${DATABASE_NAME_FILTER}'`].join(' and ')
  return listFiles(accessToken, query, MAX_LISTED_FILES, options)
}
