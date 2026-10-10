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

/** Escopos MÍNIMOS exigidos (RF03). Nada além disso é solicitado. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
] as const

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

/** `true` quando a seleção de planilha existente está configurada. */
export function isSpreadsheetPickerConfigured(): boolean {
  return googleConfig.pickerApiKey !== null
}

export const MISSING_CLIENT_ID_MESSAGE =
  'Configuração do Google ausente: defina VITE_GOOGLE_CLIENT_ID no arquivo .env (veja .env.example).'

export const MISSING_PICKER_KEY_MESSAGE =
  'Seleção de planilha indisponível: defina VITE_GOOGLE_PICKER_API_KEY no arquivo .env para usar o Google Picker.'
