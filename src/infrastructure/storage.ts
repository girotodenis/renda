import type { SpreadsheetWorkspace } from '@/types/auth'

/**
 * Persistência no navegador (RNF05): token OAuth, planilha selecionada e
 * consentimento. Nunca sai do `LocalStorage` — nenhum servidor próprio.
 */

const STORAGE_KEYS = {
  token: 'minhaacoes.oauth.token',
  workspace: 'minhaacoes.workspace',
  consent: 'minhaacoes.oauth.consent',
} as const

/** Token OAuth com expiração calculada localmente. */
export interface StoredToken {
  accessToken: string
  scope: string
  expiresAt: number
}

/** Lê e desserializa um valor JSON do `LocalStorage` (falhas → `null`). */
export function readStorageJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Serializa um valor em JSON no `LocalStorage` (ignora falhas de cota/modo privado). */
export function writeStorageJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Armazenamento indisponível (modo privado/cota): ignora silenciosamente.
  }
}

/** Remove uma chave do `LocalStorage` (ignora falhas). */
export function removeStorageKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Armazenamento indisponível: ignora silenciosamente.
  }
}

/** Lista as chaves do `LocalStorage` que começam com um prefixo. */
export function listStorageKeys(prefix: string): string[] {
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key !== null && key.startsWith(prefix)) keys.push(key)
    }
    return keys
  } catch {
    return []
  }
}

/** Remove todas as chaves do `LocalStorage` que começam com um prefixo. */
export function clearStorageKeys(prefix: string): number {
  const keys = listStorageKeys(prefix)
  for (const key of keys) removeStorageKey(key)
  return keys.length
}

export const tokenStorage = {
  load: (): StoredToken | null => readStorageJson<StoredToken>(STORAGE_KEYS.token),
  save: (token: StoredToken): void => writeStorageJson(STORAGE_KEYS.token, token),
  clear: (): void => removeStorageKey(STORAGE_KEYS.token),
}

export const workspaceStorage = {
  load: (): SpreadsheetWorkspace | null =>
    readStorageJson<SpreadsheetWorkspace>(STORAGE_KEYS.workspace),
  save: (workspace: SpreadsheetWorkspace): void =>
    writeStorageJson(STORAGE_KEYS.workspace, workspace),
  clear: (): void => removeStorageKey(STORAGE_KEYS.workspace),
}

export const consentStorage = {
  load: (): boolean => readStorageJson<boolean>(STORAGE_KEYS.consent) === true,
  save: (): void => writeStorageJson(STORAGE_KEYS.consent, true),
  clear: (): void => removeStorageKey(STORAGE_KEYS.consent),
}
