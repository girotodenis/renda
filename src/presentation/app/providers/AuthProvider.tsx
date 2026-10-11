import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from '@/presentation/app/providers/authContext'
import type {
  AuthContextValue,
  OpcoesCriarPlanilha,
  ResultadoCriacaoPlanilha,
} from '@/presentation/app/providers/authContext'
import { isOnline } from '@/application/online'
import { consentStorage, tokenStorage, workspaceStorage } from '@/infrastructure/storage'
import type { StoredToken } from '@/infrastructure/storage'
import {
  ensureAppFolder,
  findSpreadsheetsByName,
  GoogleDriveError,
  GooglePickerError,
  moveFileToFolder,
  pickSpreadsheet,
} from '@/infrastructure/drive'
import {
  GOOGLE_SCOPES,
  googleConfig,
  isGoogleConfigured,
  isSpreadsheetPickerConfigured,
  MISSING_CLIENT_ID_MESSAGE,
  MISSING_PICKER_KEY_MESSAGE,
} from '@/infrastructure/googleConfig'
import {
  GoogleAuthError,
  isTokenValid,
  isUserCancellation,
  requestAccessToken,
  revokeAccessToken,
  TOKEN_REFRESH_MARGIN_MS,
  toStoredToken,
} from '@/infrastructure/googleIdentity'
import {
  createDefaultSpreadsheet,
  loadSpreadsheetWorkspace,
  SheetsApiError,
} from '@/infrastructure/sheets/gateway'
import type { AuthStatus, SpreadsheetWorkspace } from '@/domain/workspace'

interface AuthProviderProps {
  children: ReactNode
}

/** Intervalo de nova tentativa quando a renovação silenciosa falha por rede. */
const TOKEN_REFRESH_RETRY_MS = 60_000

/**
 * Move uma planilha recém-criada para a pasta padrão do app (`minhasacoe_app`),
 * criando a pasta se necessário. Best-effort: usa apenas o escopo `drive.file`
 * (sem novas permissões) e, se falhar, a planilha permanece válida na raiz.
 */
async function organizarNaPastaDoApp(accessToken: string, spreadsheetId: string): Promise<void> {
  try {
    const folderId = await ensureAppFolder(accessToken)
    await moveFileToFolder(accessToken, spreadsheetId, folderId)
  } catch {
    // Organização é cosmética; qualquer falha não impede o uso da planilha.
  }
}

/**
 * Garante a pasta padrão do app (`minhasacoe_app`) para o Picker abrir direto
 * nela, criando-a se necessário. Best-effort: em falha devolve `null` e o Picker
 * abre no modo padrão.
 */
async function garantirPastaDoApp(accessToken: string): Promise<string | null> {
  try {
    return await ensureAppFolder(accessToken)
  } catch {
    return null
  }
}

function describeError(error: unknown): string {
  if (error instanceof SheetsApiError) {
    if (error.status === 401) return 'Sessão expirada. Faça login novamente.'
    if (error.status === 403) {
      return 'Permissão negada pelo Google. Verifique se as APIs Sheets/Drive estão habilitadas e se os escopos foram autorizados.'
    }
    if (error.status === 429) return 'Cota da API do Google excedida. Tente novamente em instantes.'
    return `Erro na API do Google Sheets: ${error.message}`
  }
  if (error instanceof GooglePickerError || error instanceof GoogleAuthError || error instanceof GoogleDriveError) {
    return error.message
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

/**
 * Provider de sessão: gerencia login OAuth (GIS), renovação automática do token
 * e a planilha ativa. Todo o estado sensível fica apenas no navegador (RNF05).
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>(isGoogleConfigured() ? 'loading' : 'unauthenticated')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<SpreadsheetWorkspace | null>(() => workspaceStorage.load())
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const tokenRef = useRef<string | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const bootstrappedRef = useRef(false)
  const silentRefreshRef = useRef<() => Promise<boolean>>(async () => false)

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  const scheduleRefreshIn = useCallback(
    (delayMs: number) => {
      clearRefreshTimer()
      refreshTimerRef.current = window.setTimeout(
        () => {
          void silentRefreshRef.current()
        },
        Math.max(delayMs, 0),
      )
    },
    [clearRefreshTimer],
  )

  const scheduleRefresh = useCallback(
    (token: StoredToken) => {
      scheduleRefreshIn(token.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS)
    },
    [scheduleRefreshIn],
  )

  const applyToken = useCallback(
    (response: GoogleTokenResponse) => {
      const stored = toStoredToken(response)
      tokenStorage.save(stored)
      consentStorage.save()
      tokenRef.current = stored.accessToken
      setAccessToken(stored.accessToken)
      scheduleRefresh(stored)
    },
    [scheduleRefresh],
  )

  const silentRefresh = useCallback(async (): Promise<boolean> => {
    const clientId = googleConfig.clientId
    if (!clientId) return false

    try {
      const response = await requestAccessToken({ clientId, scopes: GOOGLE_SCOPES, prompt: '' })
      applyToken(response)
      setStatus('authenticated')
      return true
    } catch {
      const stored = tokenStorage.load()
      // Sem rede: mantém a sessão mesmo com o token expirado — as escritas vão
      // para o outbox e a leitura é do cache, então não é preciso deslogar. A
      // segunda condição cobre a falha transitória de renovação com o token
      // ainda válido (dentro da antiga margem de segurança).
      if (stored && (!isOnline() || isTokenValid(stored, 0))) {
        tokenRef.current = stored.accessToken
        setAccessToken(stored.accessToken)
        setStatus('authenticated')
        scheduleRefreshIn(TOKEN_REFRESH_RETRY_MS)
        return true
      }
      // Falha real (consentimento revogado, popup fechado, erro do GIS): desloga.
      clearRefreshTimer()
      tokenStorage.clear()
      tokenRef.current = null
      setAccessToken(null)
      setStatus('unauthenticated')
      return false
    }
  }, [applyToken, clearRefreshTimer, scheduleRefreshIn])

  useEffect(() => {
    silentRefreshRef.current = silentRefresh
  }, [silentRefresh])

  // Ao reconectar, renova o token antes do próximo flush. A `useSync` reage ao
  // mesmo evento `online` e dispara a sincronização (chamando
  // `ensureAccessToken`), logo a renovação aqui já garante um token novo para o
  // replay. Só tenta quando há sessão persistida, para não provocar transições
  // espúrias para 'unauthenticated' em usuários sem login.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => {
      if (!tokenStorage.load()) return
      void silentRefreshRef.current()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    if (!isGoogleConfigured()) {
      setStatus('unauthenticated')
      return
    }

    const stored = tokenStorage.load()
    if (stored && isTokenValid(stored)) {
      tokenRef.current = stored.accessToken
      setAccessToken(stored.accessToken)
      scheduleRefresh(stored)
      setStatus('authenticated')
      return
    }

    if (consentStorage.load()) {
      setStatus('loading')
      void silentRefresh()
      return
    }

    setStatus('unauthenticated')
  }, [scheduleRefresh, silentRefresh])

  useEffect(() => clearRefreshTimer, [clearRefreshTimer])

  const login = useCallback(async () => {
    if (!googleConfig.clientId) {
      setError(MISSING_CLIENT_ID_MESSAGE)
      setStatus('unauthenticated')
      return
    }

    setError(null)
    setStatus('loading')
    try {
      const response = await requestAccessToken({
        clientId: googleConfig.clientId,
        scopes: GOOGLE_SCOPES,
        prompt: 'select_account',
      })
      applyToken(response)
      setStatus('authenticated')
    } catch (loginError) {
      setStatus('unauthenticated')
      if (!isUserCancellation(loginError)) {
        setError(describeError(loginError))
      }
    }
  }, [applyToken])

  const logout = useCallback(async () => {
    const current = tokenRef.current
    clearRefreshTimer()
    if (current) {
      try {
        await revokeAccessToken(current)
      } catch {
        // Falha ao revogar (inclusive por falta de rede) não impede o logout local.
      }
    }
    // A limpeza local sempre ocorre, mesmo offline (sem depender da rede).
    tokenStorage.clear()
    workspaceStorage.clear()
    consentStorage.clear()
    tokenRef.current = null
    setAccessToken(null)
    setWorkspace(null)
    setError(null)
    setStatus('unauthenticated')
  }, [clearRefreshTimer])

  const ensureAccessToken = useCallback(async (): Promise<string | null> => {
    const stored = tokenStorage.load()
    if (stored && isTokenValid(stored)) {
      tokenRef.current = stored.accessToken
      setAccessToken(stored.accessToken)
      return stored.accessToken
    }
    // Offline: usa o token armazenado mesmo expirado. As escritas vão para o
    // outbox e a leitura é do cache — não há chamada à API para autorizar, logo
    // não faz sentido tentar renovar (nem deslogar) por falta de rede.
    if (!isOnline()) {
      if (stored) {
        tokenRef.current = stored.accessToken
        setAccessToken(stored.accessToken)
        return stored.accessToken
      }
      return null
    }
    const refreshed = await silentRefresh()
    return refreshed ? tokenRef.current : null
  }, [silentRefresh])

  const salvarWorkspace = useCallback((loaded: SpreadsheetWorkspace) => {
    workspaceStorage.save(loaded)
    setWorkspace(loaded)
  }, [])

  const selecionarPlanilha = useCallback(async () => {
    setError(null)
    if (!isSpreadsheetPickerConfigured()) {
      setError(MISSING_PICKER_KEY_MESSAGE)
      return
    }

    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      setStatus('unauthenticated')
      return
    }

    setIsBusy(true)
    try {
      const folderId = await garantirPastaDoApp(token)
      const picked = await pickSpreadsheet(token, { folderId })
      if (!picked) return
      const loaded = await loadSpreadsheetWorkspace(token, picked.spreadsheetId)
      salvarWorkspace(loaded)
    } catch (selectionError) {
      setError(describeError(selectionError))
    } finally {
      setIsBusy(false)
    }
  }, [ensureAccessToken, salvarWorkspace])

  const abrirPlanilha = useCallback(
    async (spreadsheetId: string) => {
      setError(null)
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        setStatus('unauthenticated')
        return
      }

      setIsBusy(true)
      try {
        const loaded = await loadSpreadsheetWorkspace(token, spreadsheetId)
        salvarWorkspace(loaded)
      } catch (openError) {
        setError(describeError(openError))
      } finally {
        setIsBusy(false)
      }
    },
    [ensureAccessToken, salvarWorkspace],
  )

  const criarPlanilha = useCallback(
    async (title?: string, options?: OpcoesCriarPlanilha): Promise<ResultadoCriacaoPlanilha> => {
      setError(null)
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        setStatus('unauthenticated')
        return { status: 'error' }
      }

      setIsBusy(true)
      try {
        const trimmed = title?.trim() ?? ''
        if (!options?.force && trimmed.length > 0) {
          try {
            const existentes = await findSpreadsheetsByName(token, trimmed)
            const [existente] = existentes
            if (existente) return { status: 'duplicate', existente }
          } catch {
            // Falha na verificação (rede/quota): segue com a criação. O Sheets
            // aceita títulos duplicados e bloquear o usuário seria pior.
          }
        }

        const created = await createDefaultSpreadsheet(token, title)
        salvarWorkspace(created)
        await organizarNaPastaDoApp(token, created.spreadsheetId)
        return { status: 'created' }
      } catch (creationError) {
        setError(describeError(creationError))
        return { status: 'error' }
      } finally {
        setIsBusy(false)
      }
    },
    [ensureAccessToken, salvarWorkspace],
  )

  const clearError = useCallback(() => setError(null), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      accessToken,
      workspace,
      error,
      isConfigured: isGoogleConfigured(),
      isPickerConfigured: isSpreadsheetPickerConfigured(),
      isBusy,
      login,
      logout,
      selecionarPlanilha,
      criarPlanilha,
      abrirPlanilha,
      ensureAccessToken,
      clearError,
    }),
    [
      abrirPlanilha,
      accessToken,
      clearError,
      criarPlanilha,
      ensureAccessToken,
      error,
      isBusy,
      login,
      logout,
      selecionarPlanilha,
      status,
      workspace,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
