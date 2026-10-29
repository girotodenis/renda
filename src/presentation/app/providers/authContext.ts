import { createContext, useContext } from 'react'
import type { ModoArmazenamento } from '@/domain/armazenamento'
import type { AuthStatus, PlanilhaExistente, SpreadsheetWorkspace } from '@/domain/workspace'

/** Opções de criação do banco padrão. */
export interface OpcoesCriarBanco {
  /** Ignora a verificação de nome duplicado e cria um banco novo. */
  force?: boolean
}

/** Resultado de uma tentativa de criação do banco padrão. */
export type ResultadoCriacaoBanco =
  | { status: 'created' }
  | { status: 'duplicate'; existente: PlanilhaExistente }
  | { status: 'error' }

/** Contexto de sessão exposto pelo `AuthProvider`. */
export interface AuthContextValue {
  /**
   * Estado da sessão: `loading` (restaurando), `unauthenticated` (sem sessão),
   * `authenticated` (token válido) ou `local` (planilha persistida sem token
   * válido — o app opera com o cache e o login é solicitado sob demanda).
   */
  status: AuthStatus
  /**
   * Origem de dados ativa: `google` (nuvem, com login — planilha do Sheets ou
   * arquivo JSON no Drive, conforme `VITE_GOOGLE_BACKEND`) ou `local` (banco de
   * dados do navegador, sem login e exportável para `.ods`).
   */
  modo: ModoArmazenamento
  /** Atalho para `modo === 'local'`. */
  isModoLocal: boolean
  /** Access token OAuth (mantido apenas em memória + LocalStorage). */
  accessToken: string | null
  /** Banco selecionado/criado e persistido no navegador. */
  workspace: SpreadsheetWorkspace | null
  /** Mensagem de erro amigável (pt-BR) da última operação, se houver. */
  error: string | null
  /** `true` quando `VITE_GOOGLE_CLIENT_ID` está definido. */
  isConfigured: boolean
  /**
   * `true` quando o Google Picker está disponível (`VITE_GOOGLE_PICKER_API_KEY`).
   * A lista de bancos do Drive funciona sem ele; o Picker é apenas a forma de
   * abrir uma planilha que o app ainda não conhece.
   */
  isPickerConfigured: boolean
  /** `true` enquanto uma ação (criar/selecionar planilha) está em andamento. */
  isBusy: boolean
  /** Inicia o login OAuth 2.0 pelo Google Identity Services. */
  login: () => Promise<void>
  /** Revoga o token e limpa a sessão/planilha persistida (também sai do modo local). */
  logout: () => Promise<void>
  /**
   * Ativa o modo local (sem Google): cria/abre o banco de dados do navegador e
   * o define como workspace ativo. Não exige login e preserva dados existentes.
   */
  usarModoLocal: () => Promise<void>
  /**
   * Lista os bancos já existentes na origem ativa (arquivos JSON no Drive ou
   * planilhas visíveis para o app), do mais recente para o mais antigo.
   * Devolve `[]` e preenche `error` quando não é possível listar.
   */
  listarBancos: () => Promise<PlanilhaExistente[]>
  /**
   * Abre o Google Picker para escolher uma planilha que o app ainda não conhece
   * (backend `sheets`, quando `VITE_GOOGLE_PICKER_API_KEY` está definido).
   */
  abrirPlanilhaNoPicker: () => Promise<void>
  /**
   * Cria o banco padrão (as 7 abas do schema) e o define como workspace.
   *
   * Antes de criar, verifica se já existe um banco com o mesmo nome. Quando
   * existe (e `options.force` não está ligado), devolve
   * `{ status: 'duplicate' }` sem criar nada, para que a UI pergunte ao usuário.
   */
  criarBanco: (
    title?: string,
    options?: OpcoesCriarBanco,
  ) => Promise<ResultadoCriacaoBanco>
  /**
   * Torna ativo um banco existente pelo id (planilha no Sheets ou arquivo no
   * Drive, conforme o backend), garantindo as abas do schema.
   */
  abrirBancoPorId: (spreadsheetId: string) => Promise<void>
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
