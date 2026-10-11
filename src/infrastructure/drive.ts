import type { PlanilhaExistente } from '@/domain/workspace'
import { loadScript } from '@/infrastructure/loadScript'
import { googleConfig, MISSING_PICKER_KEY_MESSAGE } from '@/infrastructure/googleConfig'

/**
 * Google Drive — seleção de planilha existente via Google Picker (RF02) e
 * busca por título (detecção de planilhas duplicadas antes de criar).
 *
 * O Picker usa o access token OAuth do usuário diretamente e exige uma chave de
 * API (`VITE_GOOGLE_PICKER_API_KEY`). Sob o escopo `drive.file`, o Picker é a
 * forma correta de conceder acesso a um arquivo existente.
 */

const GAPI_SCRIPT_SRC = 'https://apis.google.com/js/api.js'
const GAPI_LOAD_TIMEOUT_MS = 15000
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

/**
 * Nome da pasta padrão onde o app organiza as planilhas que cria.
 *
 * A pasta é criada PELO app, então o escopo `drive.file` já a cobre — não é
 * preciso pedir nenhuma permissão adicional (nem novo consentimento).
 */
export const DEFAULT_APP_FOLDER_NAME = 'minhasacoe_app'

let gapiScriptPromise: Promise<void> | null = null
let pickerLibraryPromise: Promise<void> | null = null

/** Erro originado do Google Picker / Drive. */
export class GooglePickerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GooglePickerError'
  }
}

/** Erro originado da API do Google Drive (`files.list`). */
export class GoogleDriveError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleDriveError'
  }
}

export type DriveSpreadsheetSelection = PlanilhaExistente

/** Converte uma resposta HTTP de falha do Drive em `GoogleDriveError` (pt-BR). */
function toDriveError(response: Response): GoogleDriveError {
  if (response.status === 401) {
    return new GoogleDriveError(401, 'Sessão expirada. Faça login novamente.')
  }
  if (response.status === 403) {
    return new GoogleDriveError(
      403,
      'Permissão negada pelo Google Drive. Verifique se a API Drive está habilitada e se os escopos foram autorizados.',
    )
  }
  if (response.status === 429) {
    return new GoogleDriveError(429, 'Cota da API do Google excedida. Tente novamente em instantes.')
  }
  return new GoogleDriveError(response.status, `Falha na API do Google Drive (HTTP ${response.status}).`)
}

/** `true` quando a seleção de planilha existente pode ser oferecida na UI. */
export function isSpreadsheetSelectionAvailable(): boolean {
  return googleConfig.pickerApiKey !== null
}

interface DriveFileListResponse {
  files?: { id?: string; name?: string }[]
}

interface DriveFileResponse {
  id?: string
  parents?: string[]
}

/**
 * Busca, no Drive, planilhas cujo título é exatamente `title` (RF02).
 *
 * É usada antes de criar a planilha padrão para detectar um nome já existente.
 * Sob o escopo `drive.file` a listagem enxerga apenas arquivos criados/abertos
 * por este app — suficiente para as planilhas da carteira.
 *
 * Lança `GoogleDriveError` em falha da API; o chamador decide se segue com a
 * criação (falha aberta).
 */
export async function findSpreadsheetsByName(
  accessToken: string,
  title: string,
): Promise<DriveSpreadsheetSelection[]> {
  const trimmed = title.trim()
  if (trimmed.length === 0) return []

  const escapedTitle = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const query = [
    `name = '${escapedTitle}'`,
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    'trashed = false',
  ].join(' and ')

  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
  })

  const response = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw toDriveError(response)
  }

  const body = (await response.json()) as DriveFileListResponse
  const found: DriveSpreadsheetSelection[] = []
  for (const file of body.files ?? []) {
    if (typeof file.id === 'string' && typeof file.name === 'string') {
      found.push({ spreadsheetId: file.id, title: file.name })
    }
  }
  return found
}

/** Escapa um valor para uso seguro dentro de uma consulta do Drive (`q`). */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Procura a pasta padrão do app e devolve seu id — ou `null` se ela ainda não
 * existir. Não tem efeitos colaterais (não cria nada), o que permite usá-la para
 * posicionar o Picker sem criar a pasta só por abrir a seleção.
 *
 * Lança `GoogleDriveError` em falha da API; o chamador decide se segue (falha aberta).
 */
export async function findAppFolder(
  accessToken: string,
  name: string = DEFAULT_APP_FOLDER_NAME,
): Promise<string | null> {
  const trimmed = name.trim().length > 0 ? name.trim() : DEFAULT_APP_FOLDER_NAME
  const query = [
    `name = '${escapeDriveQueryValue(trimmed)}'`,
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
    'trashed = false',
  ].join(' and ')

  const params = new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1' })
  const found = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!found.ok) throw toDriveError(found)

  const foundBody = (await found.json()) as DriveFileListResponse
  const existingId = foundBody.files?.[0]?.id
  return typeof existingId === 'string' && existingId.length > 0 ? existingId : null
}

/**
 * Garante a existência da pasta padrão do app (`minhasacoe_app`) e devolve seu id.
 *
 * É compatível com o escopo `drive.file`: a pasta é criada PELO app, que passa a
 * enxergá-la e gerenciá-la sem escopos adicionais. Limitação inerente ao escopo:
 * se o usuário criar manualmente uma pasta com o mesmo nome, o app não a verá
 * (o `drive.file` só dá visibilidade a arquivos que o app criou/abriu) e criará
 * a sua própria.
 *
 * Lança `GoogleDriveError` em falha da API; o chamador decide se segue (falha aberta).
 */
export async function ensureAppFolder(
  accessToken: string,
  name: string = DEFAULT_APP_FOLDER_NAME,
): Promise<string> {
  const existing = await findAppFolder(accessToken, name)
  if (existing) return existing

  const trimmed = name.trim().length > 0 ? name.trim() : DEFAULT_APP_FOLDER_NAME
  const created = await fetch(`${DRIVE_FILES_ENDPOINT}?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: trimmed, mimeType: DRIVE_FOLDER_MIME_TYPE }),
  })
  if (!created.ok) throw toDriveError(created)

  const createdBody = (await created.json()) as DriveFileResponse
  if (typeof createdBody.id !== 'string' || createdBody.id.length === 0) {
    throw new GoogleDriveError(500, 'O Google Drive não retornou o id da pasta criada.')
  }
  return createdBody.id
}

/**
 * Move para `folderId` um arquivo que o app criou, removendo o(s) pai(s) atual(is).
 *
 * O escopo `drive.file` cobre a operação porque tanto o arquivo quanto a pasta
 * foram criados pelo app. Lança `GoogleDriveError` em falha; o chamador trata
 * como best-effort (a planilha continua válida na raiz se a organização falhar).
 */
export async function moveFileToFolder(
  accessToken: string,
  fileId: string,
  folderId: string,
): Promise<void> {
  const parentsResponse = await fetch(
    `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?fields=parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!parentsResponse.ok) throw toDriveError(parentsResponse)

  const body = (await parentsResponse.json()) as DriveFileResponse
  const previousParents = (body.parents ?? []).filter((parent) => parent !== folderId)

  const params = new URLSearchParams({ addParents: folderId })
  if (previousParents.length > 0) params.set('removeParents', previousParents.join(','))

  const response = await fetch(
    `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${params.toString()}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!response.ok) throw toDriveError(response)
}

function loadGapiScript(): Promise<void> {
  if (window.gapi) return Promise.resolve()
  if (!gapiScriptPromise) {
    gapiScriptPromise = loadScript(GAPI_SCRIPT_SRC).catch((error: unknown) => {
      gapiScriptPromise = null
      throw error
    })
  }
  return gapiScriptPromise
}

function loadPickerLibrary(): Promise<void> {
  if (pickerLibraryPromise) return pickerLibraryPromise

  pickerLibraryPromise = loadGapiScript()
    .then(
      () =>
        new Promise<void>((resolve, reject) => {
          const gapi = window.gapi
          if (!gapi) {
            reject(new GooglePickerError('Google API Loader indisponível.'))
            return
          }
          gapi.load('picker', {
            callback: () => resolve(),
            onerror: () => reject(new GooglePickerError('Não foi possível carregar o Google Picker.')),
            timeout: GAPI_LOAD_TIMEOUT_MS,
            ontimeout: () => reject(new GooglePickerError('Tempo esgotado ao carregar o Google Picker.')),
          })
        }),
    )
    .catch((error: unknown) => {
      pickerLibraryPromise = null
      throw error
    })

  return pickerLibraryPromise
}

/** Opções de abertura do Google Picker. */
export interface PickSpreadsheetOptions {
  /**
   * Pasta exibida inicialmente pelo Picker. Quando o app já criou a pasta
   * `minhasacoe_app`, o Picker abre direto nela; o usuário ainda pode navegar
   * para outras pastas (inclusive a raiz) normalmente.
   */
  folderId?: string | null
}

/**
 * Abre o Google Picker para o usuário escolher uma planilha existente.
 * Retorna `null` quando o usuário cancela a seleção.
 */
export async function pickSpreadsheet(
  accessToken: string,
  options?: PickSpreadsheetOptions,
): Promise<DriveSpreadsheetSelection | null> {
  const apiKey = googleConfig.pickerApiKey
  if (!apiKey) {
    throw new GooglePickerError(MISSING_PICKER_KEY_MESSAGE)
  }

  await loadPickerLibrary()
  const pickerApi = window.google?.picker
  if (!pickerApi) {
    throw new GooglePickerError('Google Picker indisponível.')
  }

  return new Promise<DriveSpreadsheetSelection | null>((resolve, reject) => {
    try {
      const view = new pickerApi.DocsView(pickerApi.ViewId.SPREADSHEETS)
        .setMimeTypes('application/vnd.google-apps.spreadsheet')
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false)

      if (options?.folderId) {
        view.setParent(options.folderId)
      }

      const builder = new pickerApi.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setTitle('Selecione a planilha da sua carteira')
        .setLocale('pt-BR')
        .setCallback((data) => {
          const action = typeof data.action === 'string' ? data.action : ''
          if (action === pickerApi.Action.PICKED) {
            const document = data.docs?.[0]
            resolve(document ? { spreadsheetId: document.id, title: document.name } : null)
          } else if (action === pickerApi.Action.CANCEL) {
            resolve(null)
          }
        })

      if (googleConfig.projectNumber) {
        builder.setAppId(googleConfig.projectNumber)
      }

      builder.build().setVisible(true)
    } catch (error) {
      reject(error instanceof Error ? error : new GooglePickerError('Falha ao abrir o Google Picker.'))
    }
  })
}
