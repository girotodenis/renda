import type { SpreadsheetWorkspace } from '@/domain/workspace'
import { parseLayoutTema } from '@/domain/layout'
import type { LayoutTema } from '@/domain/layout'

/**
 * Persistência no navegador (RNF05): token OAuth, planilha selecionada,
 * consentimento e tema de layout. Nunca sai do `LocalStorage` — nenhum servidor
 * próprio.
 */

const STORAGE_KEYS = {
  token: 'minhaacoes.oauth.token',
  workspace: 'minhaacoes.workspace',
  consent: 'minhaacoes.oauth.consent',
  layout: 'minhaacoes.layout',
  pastaApp: 'minhaacoes.drive.pasta',
} as const

/**
 * Banco legado (planilha do Sheets) cuja oferta de migração foi dispensada.
 *
 * Fica fora de `STORAGE_KEYS` porque não é JSON: guarda o `spreadsheetId` puro,
 * e a oferta deve sumir só para **aquele** banco (§6.6).
 */
const MIGRACAO_DISPENSADA_KEY = 'minhaacoes.migracao.v1.dispensada'

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

export const layoutStorage = {
  load: (): LayoutTema => parseLayoutTema(readStorageJson<string>(STORAGE_KEYS.layout)),
  save: (tema: LayoutTema): void => writeStorageJson(STORAGE_KEYS.layout, tema),
}

/**
 * URL da pasta do app no Drive (`databases_app_minhas_acoes`).
 *
 * Fica fora do workspace porque a pasta é da **conta**, não do banco: assim o
 * botão "Abrir no Google Drive" funciona mesmo em bancos abertos antes de a
 * URL passar a ser conhecida (ou depois de trocar de banco).
 */
export const pastaAppStorage = {
  load: (): string | null => {
    const url = readStorageJson<string>(STORAGE_KEYS.pastaApp)
    return typeof url === 'string' && url.length > 0 ? url : null
  },
  save: (url: string): void => writeStorageJson(STORAGE_KEYS.pastaApp, url),
  clear: (): void => removeStorageKey(STORAGE_KEYS.pastaApp),
}

/** Dispensa da oferta de migração do banco legado (`migrarPlanilha`). */
export const migracaoStorage = {
  /** Id do banco legado cuja oferta já foi dispensada (`null` = nenhum). */
  dispensada: (): string | null => {
    try {
      const valor = window.localStorage.getItem(MIGRACAO_DISPENSADA_KEY)
      return valor && valor.length > 0 ? valor : null
    } catch {
      return null
    }
  },
  /** Marca a oferta como dispensada para o banco informado. */
  dispensar: (spreadsheetId: string): void => {
    try {
      window.localStorage.setItem(MIGRACAO_DISPENSADA_KEY, spreadsheetId)
    } catch {
      // Armazenamento indisponível (modo privado/cota): a oferta reaparece.
    }
  },
  limpar: (): void => removeStorageKey(MIGRACAO_DISPENSADA_KEY),
}
