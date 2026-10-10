import { createContext, useContext } from 'react'
import type { AuthStatus, SpreadsheetWorkspace } from '@/types/auth'

/** Contexto de sessão exposto pelo `AuthProvider`. */
export interface AuthContextValue {
  /** Estado da sessão: carregando, não autenticado ou autenticado. */
  status: AuthStatus
  /** Access token OAuth (mantido apenas em memória + LocalStorage). */
  accessToken: string | null
  /** Planilha selecionada/criada e persistida no navegador. */
  workspace: SpreadsheetWorkspace | null
  /** Mensagem de erro amigável (pt-BR) da última operação, se houver. */
  error: string | null
  /** `true` quando `VITE_GOOGLE_CLIENT_ID` está definido. */
  isConfigured: boolean
  /** `true` quando o Google Picker está disponível (`VITE_GOOGLE_PICKER_API_KEY`). */
  isPickerConfigured: boolean
  /** `true` enquanto uma ação (criar/selecionar planilha) está em andamento. */
  isBusy: boolean
  /** Inicia o login OAuth 2.0 pelo Google Identity Services. */
  login: () => Promise<void>
  /** Revoga o token e limpa a sessão/planilha persistida. */
  logout: () => Promise<void>
  /** Abre o Google Picker e carrega a planilha selecionada. */
  selecionarPlanilha: () => Promise<void>
  /** Cria uma planilha padrão com as 5 abas e a define como workspace. */
  criarPlanilha: (title?: string) => Promise<void>
  /**
   * Garante um access token válido (renova silenciosamente se necessário).
   * Retorna `null` quando não foi possível obter um token.
   */
  ensureAccessToken: () => Promise<string | null>
  /** Limpa a mensagem de erro atual. */
  clearError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** Hook de acesso ao contexto de sessão. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>.')
  }
  return context
}
