import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from '@/presentation/app/providers/authContext'
import type {
  AuthContextValue,
  OpcoesCriarPlanilha,
  ResultadoCriacaoPlanilha,
} from '@/presentation/app/providers/authContext'
import { isOnline } from '@/application/online'
import {
  isWorkspaceLocal,
  MODO_ARMAZENAMENTO_PADRAO,
  MODO_LOCAL,
  TOKEN_MODO_LOCAL,
} from '@/domain/armazenamento'
import type { ModoArmazenamento } from '@/domain/armazenamento'
import {
  getModoArmazenamento,
  isModoLocal,
  setModoArmazenamento,
} from '@/infrastructure/modoArmazenamento'
import { tokenStorage, workspaceStorage } from '@/infrastructure/storage'
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
  toStoredToken,
} from '@/infrastructure/googleIdentity'
import {
  abrirWorkspace,
  criarWorkspace,
  prepararWorkspaceLocal,
  SheetsApiError,
} from '@/infrastructure/sheets/gatewayRouter'
import type { AuthStatus, SpreadsheetWorkspace } from '@/domain/workspace'

interface AuthProviderProps {
  children: ReactNode
}

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
 * Provider de sessão: gerencia login OAuth (GIS), a planilha ativa e o **modo
 * de armazenamento** (Google Sheets ou banco local do navegador). O token é
 * renovado **sob demanda** — apenas quando uma operação precisa da rede — sem
 * renovação em segundo plano (que abria o login do Google periodicamente).
 * Com planilha persistida, o app abre em modo local (cache) sem acionar o
 * login. Todo o estado sensível fica apenas no navegador (RNF05).
 *
 * O modo local (RF02, sem Google) dispensa OAuth por completo: a carteira vive
 * no IndexedDB e pode ser exportada para `.ods`. O token devolvido por
 * `ensureAccessToken` é apenas um sentinela nesse modo.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [modo, setModo] = useState<ModoArmazenamento>(() => getModoArmazenamento())
  const [status, setStatus] = useState<AuthStatus>(() =>
    isModoLocal() || isGoogleConfigured() ? 'loading' : 'unauthenticated',
  )
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<SpreadsheetWorkspace | null>(() => workspaceStorage.load())
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const tokenRef = useRef<string | null>(null)
  const bootstrappedRef = useRef(false)

  const applyToken = useCallback((response: GoogleTokenResponse) => {
    const stored = toStoredToken(response)
    tokenStorage.save(stored)
    tokenRef.current = stored.accessToken
    setAccessToken(stored.accessToken)
    setStatus('authenticated')
  }, [])

  /**
   * Renovação silenciosa **sob demanda** (`prompt: ''`, sem UI): só roda
   * quando uma operação precisa da rede. Falhas não derrubam a sessão — com
   * planilha persistida, o app segue em modo local (cache) até o usuário
   * logar de novo por ação explícita.
   */
  const silentRefresh = useCallback(async (): Promise<boolean> => {
    // No modo local não existe OAuth: nada a renovar.
    if (isModoLocal()) return false

    const clientId = googleConfig.clientId
    if (!clientId) return false

    try {
      const response = await requestAccessToken({ clientId, scopes: GOOGLE_SCOPES, prompt: '' })
      applyToken(response)
      return true
    } catch {
      // Falha real ou transitória (sem sessão Google ativa, cookies de
      // terceiros bloqueados, consentimento revogado): não desloga — apenas
      // informa ao chamador que não há token disponível.
      setStatus(workspaceStorage.load() ? 'local' : 'unauthenticated')
      return false
    }
  }, [applyToken])

  // Bootstrap da sessão: entra direto, sem chamar o Google, sempre que
  // possível. No modo local, garante o banco do navegador e entra. Com
  // planilha configurada e token expirado/ausente, abre em modo local (dados do
  // cache) em vez de forçar o login.
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    if (isModoLocal()) {
      void (async () => {
        try {
          const stored = workspaceStorage.load()
          const local =
            stored && isWorkspaceLocal(stored.spreadsheetId) ? stored : null
          const workspaceLocal = local ?? (await prepararWorkspaceLocal())
          workspaceStorage.save(workspaceLocal)
          setWorkspace(workspaceLocal)
          setStatus('local')
        } catch {
          setError('Não foi possível abrir o banco de dados local deste navegador.')
          setStatus('unauthenticated')
        }
      })()
      return
    }

    if (!isGoogleConfigured()) {
      setStatus('unauthenticated')
      return
    }

    const stored = tokenStorage.load()
    if (stored && isTokenValid(stored)) {
      tokenRef.current = stored.accessToken
      setAccessToken(stored.accessToken)
      setStatus('authenticated')
      return
    }

    setStatus(workspaceStorage.load() ? 'local' : 'unauthenticated')
  }, [])

  /**
   * Ativa o modo local (sem Google): garante as abas no banco do navegador e o
   * define como workspace ativo. A carteira local **não** é apagada se já
   * existir.
   */
  const usarModoLocal = useCallback(async () => {
    setError(null)
    setIsBusy(true)
    try {
      const workspaceLocal = await prepararWorkspaceLocal()
      setModoArmazenamento(MODO_LOCAL)
      setModo(MODO_LOCAL)
      workspaceStorage.save(workspaceLocal)
      setWorkspace(workspaceLocal)
      setStatus('local')
    } catch {
      setError('Não foi possível ativar o modo local neste navegador.')
    } finally {
      setIsBusy(false)
    }
  }, [])

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
      // Entrar com o Google significa sair do modo local: a carteira do
      // navegador permanece no IndexedDB (pode ser reaberta depois), mas deixa
      // de ser a origem ativa.
      if (isModoLocal()) {
        setModoArmazenamento(MODO_ARMAZENAMENTO_PADRAO)
        setModo(MODO_ARMAZENAMENTO_PADRAO)
        const stored = workspaceStorage.load()
        if (stored && isWorkspaceLocal(stored.spreadsheetId)) {
          workspaceStorage.clear()
          setWorkspace(null)
        }
      }
      setStatus('authenticated')
    } catch (loginError) {
      setStatus(workspaceStorage.load() ? 'local' : 'unauthenticated')
      if (!isUserCancellation(loginError)) {
        setError(describeError(loginError))
      }
    }
  }, [applyToken])

  const logout = useCallback(async () => {
    const current = tokenRef.current
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
    // Sair também encerra o modo local: a carteira do navegador fica guardada
    // no IndexedDB e pode ser reaberta pelo botão "Usar sem Google".
    setModoArmazenamento(MODO_ARMAZENAMENTO_PADRAO)
    setModo(MODO_ARMAZENAMENTO_PADRAO)
    tokenRef.current = null
    setAccessToken(null)
    setWorkspace(null)
    setError(null)
    setStatus('unauthenticated')
  }, [])

  const ensureAccessToken = useCallback(async (): Promise<string | null> => {
    // Modo local: não há OAuth. O sentinela mantém os casos de uso e a UI
    // funcionando sem condicionais de modo (nunca vai para a rede).
    if (isModoLocal()) {
      tokenRef.current = TOKEN_MODO_LOCAL
      return TOKEN_MODO_LOCAL
    }

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
    if (isModoLocal()) {
      setError(
        'Você está no modo local (sem Google). Saia do modo local para usar uma planilha do Google.',
      )
      return
    }
    if (!isSpreadsheetPickerConfigured()) {
      setError(MISSING_PICKER_KEY_MESSAGE)
      return
    }

    const token = await ensureAccessToken()
    if (!token) {
      // Sem token: `ensureAccessToken` já ajustou o status (modo local quando
      // há planilha persistida); basta avisar o usuário.
      setError('Sessão expirada. Faça login novamente.')
      return
    }

    setIsBusy(true)
    try {
      const folderId = await garantirPastaDoApp(token)
      const picked = await pickSpreadsheet(token, { folderId })
      if (!picked) return
      const loaded = await abrirWorkspace(token, picked.spreadsheetId)
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
      if (isModoLocal()) {
        setError(
          'Você está no modo local (sem Google). Saia do modo local para usar uma planilha do Google.',
        )
        return
      }
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }

      setIsBusy(true)
      try {
        const loaded = await abrirWorkspace(token, spreadsheetId)
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
      if (isModoLocal()) {
        setError(
          'Você está no modo local (sem Google). Saia do modo local para usar uma planilha do Google.',
        )
        return { status: 'error' }
      }
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
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

        const created = await criarWorkspace(token, title)
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
      modo,
      isModoLocal: modo === MODO_LOCAL,
      accessToken,
      workspace,
      error,
      isConfigured: isGoogleConfigured(),
      isPickerConfigured: isSpreadsheetPickerConfigured(),
      isBusy,
      login,
      logout,
      usarModoLocal,
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
      modo,
      selecionarPlanilha,
      status,
      usarModoLocal,
      workspace,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
