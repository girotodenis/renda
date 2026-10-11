import { loadScript } from '@/infrastructure/loadScript'
import { googleConfig, MISSING_PICKER_KEY_MESSAGE } from '@/infrastructure/googleConfig'

/**
 * Google Drive — seleção de planilha existente via Google Picker (RF02).
 *
 * O Picker usa o access token OAuth do usuário diretamente e exige uma chave de
 * API (`VITE_GOOGLE_PICKER_API_KEY`). Sob o escopo `drive.file`, o Picker é a
 * forma correta de conceder acesso a um arquivo existente.
 */

const GAPI_SCRIPT_SRC = 'https://apis.google.com/js/api.js'
const GAPI_LOAD_TIMEOUT_MS = 15000

let gapiScriptPromise: Promise<void> | null = null
let pickerLibraryPromise: Promise<void> | null = null

/** Erro originado do Google Picker / Drive. */
export class GooglePickerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GooglePickerError'
  }
}

export interface DriveSpreadsheetSelection {
  spreadsheetId: string
  title: string
}

/** `true` quando a seleção de planilha existente pode ser oferecida na UI. */
export function isSpreadsheetSelectionAvailable(): boolean {
  return googleConfig.pickerApiKey !== null
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

/**
 * Abre o Google Picker para o usuário escolher uma planilha existente.
 * Retorna `null` quando o usuário cancela a seleção.
 */
export async function pickSpreadsheet(accessToken: string): Promise<DriveSpreadsheetSelection | null> {
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
