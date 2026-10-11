import { loadScript } from '@/infrastructure/loadScript'
import type { StoredToken } from '@/infrastructure/storage'

/**
 * Google Identity Services (GIS) — OAuth 2.0 (RF01, RNF05).
 *
 * Toda a troca de tokens acontece no navegador, nunca em servidor próprio.
 */

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

/** Margem antes da expiração para renovar o token silenciosamente. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600

let gisScriptPromise: Promise<void> | null = null

/** Erro originado do fluxo OAuth do Google. */
export class GoogleAuthError extends Error {
  constructor(
    public readonly code: string,
    description?: string,
  ) {
    super(description && description.length > 0 ? description : code)
    this.name = 'GoogleAuthError'
  }
}

/** Injeta a biblioteca do GIS uma única vez. */
export function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve()
  if (!gisScriptPromise) {
    gisScriptPromise = loadScript(GIS_SCRIPT_SRC).catch((error: unknown) => {
      gisScriptPromise = null
      throw error
    })
  }
  return gisScriptPromise
}

export interface AccessTokenRequest {
  clientId: string
  scopes: readonly string[]
  /**
   * `''` renova o token sem interação (silent refresh); `'select_account'`
   * abre a escolha de conta no primeiro login.
   */
  prompt?: string
}

/**
 * Solicita um access token ao GIS. Com `prompt: ''` o Google devolve um token
 * silenciosamente quando o usuário já consentiu — sem novo login (RNF05).
 */
export async function requestAccessToken(request: AccessTokenRequest): Promise<GoogleTokenResponse> {
  await loadGoogleIdentityScript()
  const oauth2 = window.google?.accounts.oauth2
  if (!oauth2) {
    throw new GoogleAuthError('gsis_unavailable', 'Google Identity Services indisponível.')
  }

  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: request.clientId,
      scope: request.scopes.join(' '),
      prompt: request.prompt,
      callback: (response) => {
        if (response.error) {
          reject(new GoogleAuthError(response.error, response.error_description))
          return
        }
        resolve(response)
      },
      error_callback: (error) => {
        reject(new GoogleAuthError(error.type, error.message))
      },
    })
    client.requestAccessToken()
  })
}

/** Converte a resposta do GIS no token persistido (com expiração absoluta). */
export function toStoredToken(response: GoogleTokenResponse): StoredToken {
  const lifetimeSeconds =
    typeof response.expires_in === 'number' && response.expires_in > 0
      ? response.expires_in
      : DEFAULT_TOKEN_LIFETIME_SECONDS

  return {
    accessToken: response.access_token,
    scope: response.scope,
    expiresAt: Date.now() + lifetimeSeconds * 1000,
  }
}

/** `true` quando o token ainda é válido considerando a margem de renovação. */
export function isTokenValid(token: StoredToken, marginMs: number = TOKEN_REFRESH_MARGIN_MS): boolean {
  return token.expiresAt - marginMs > Date.now()
}

/** Revoga o token no Google (usado no logout). */
export async function revokeAccessToken(accessToken: string): Promise<void> {
  await loadGoogleIdentityScript()
  const oauth2 = window.google?.accounts.oauth2
  if (!oauth2) return
  await new Promise<void>((resolve) => {
    oauth2.revoke(accessToken, () => resolve())
  })
}

/** `true` quando o erro representa o usuário fechando/negando o popup. */
export function isUserCancellation(error: unknown): boolean {
  return error instanceof GoogleAuthError && (error.code === 'popup_closed' || error.code === 'access_denied')
}
