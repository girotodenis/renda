/**
 * Configuração do Google lida de variáveis de ambiente do Vite.
 *
 * Nenhum segredo é comitado: o Client ID e a chave do Picker vêm de `.env`.
 * Quando ausentes, o app exibe um erro claro em vez de quebrar em runtime.
 */

function readEnv(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Backend do modo Google: planilha (`sheets`) ou arquivo JSON no Drive (`json`). */
export type GoogleBackend = 'sheets' | 'json'

/**
 * Selecionado em tempo de BUILD por `VITE_GOOGLE_BACKEND`.
 *
 * `json` é o padrão: cofre único no Drive, com criptografia opcional. `sheets`
 * é o build alternativo **sem criptografia** (as células precisam ficar
 * legíveis para as fórmulas).
 */
export const GOOGLE_BACKEND: GoogleBackend =
  import.meta.env.VITE_GOOGLE_BACKEND === 'sheets' ? 'sheets' : 'json'

/**
 * Escopos MÍNIMOS exigidos (RF03). Nada além disso é solicitado.
 *
 * No backend `json` basta `drive.file`: é um escopo NÃO sensível, então o app
 * dispensa a verificação OAuth do Google. O backend `sheets` (alternativo)
 * continua pedindo `spreadsheets`.
 */
export const GOOGLE_SCOPES: readonly string[] =
  GOOGLE_BACKEND === 'json'
    ? ['https://www.googleapis.com/auth/drive.file']
    : [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ]

/**
 * Escopo da Sheets API usado pela **planilha de cotações** (integração
 * opcional, autorizada por ação explícita em Configurações).
 */
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

/**
 * Escopos do login + o da planilha de cotações, sem duplicar o que
 * `GOOGLE_SCOPES` já pede (no backend `sheets` o escopo já está incluído).
 */
export const SCOPES_COM_PLANILHA: readonly string[] = GOOGLE_SCOPES.includes(SHEETS_SCOPE)
  ? [...GOOGLE_SCOPES]
  : [...GOOGLE_SCOPES, SHEETS_SCOPE]

/**
 * `true` quando a string de escopos devolvida pelo Google inclui `escopo`.
 * O Google devolve os escopos separados por espaço.
 */
export function tokenTemEscopo(scope: string, escopo: string): boolean {
  return scope.split(/\s+/).includes(escopo)
}

export interface GoogleConfig {
  clientId: string | null
  pickerApiKey: string | null
  projectNumber: string | null
}

export const googleConfig: GoogleConfig = {
  clientId: readEnv(import.meta.env.VITE_GOOGLE_CLIENT_ID),
  pickerApiKey: readEnv(import.meta.env.VITE_GOOGLE_PICKER_API_KEY),
  projectNumber: readEnv(import.meta.env.VITE_GOOGLE_PROJECT_NUMBER),
}

/** `true` quando o login OAuth está configurado (`VITE_GOOGLE_CLIENT_ID`). */
export function isGoogleConfigured(): boolean {
  return googleConfig.clientId !== null
}

/** `true` quando o backend ativo grava um único arquivo JSON no Drive. */
export function isJsonBackend(): boolean {
  return GOOGLE_BACKEND === 'json'
}

/** `true` quando a seleção de planilha existente está configurada. */
export function isSpreadsheetPickerConfigured(): boolean {
  return googleConfig.pickerApiKey !== null
}

export const MISSING_CLIENT_ID_MESSAGE =
  'Configuração do Google ausente: defina VITE_GOOGLE_CLIENT_ID no arquivo .env (veja .env.example).'

export const MISSING_PICKER_KEY_MESSAGE =
  'Seleção de planilha indisponível: defina VITE_GOOGLE_PICKER_API_KEY no arquivo .env para usar o Google Picker.'
