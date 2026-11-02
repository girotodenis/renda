import { createContext, useContext } from 'react'
import type { ModoArmazenamento } from '@/domain/armazenamento'
import type {
  AuthStatus,
  CriptografiaBanco,
  PlanilhaExistente,
  SpreadsheetWorkspace,
} from '@/domain/workspace'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'

/** Opções de criação do banco padrão. */
export interface OpcoesCriarBanco {
  /** Ignora a verificação de nome duplicado e cria um banco novo. */
  force?: boolean
  /**
   * Sessão de criptografia: com ela o banco **nasce cifrado** e já entra
   * desbloqueado (o usuário acabou de digitar a senha).
   */
  chave?: SessaoCripto
}

/** Resultado de uma tentativa de criação do banco padrão. */
export type ResultadoCriacaoBanco =
  | { status: 'created' }
  | { status: 'duplicate'; existente: PlanilhaExistente }
  | { status: 'error' }

/**
 * Resultado de abrir um banco pelo id.
 *
 * `chave-necessaria` é um resultado **esperado**, não um erro: o banco está
 * cifrado e sem chave na sessão. O workspace ativo não muda e `error` continua
 * limpo — a UI decide pedir a senha (2º passo do `AbrirBancoModal`).
 */
export type ResultadoAberturaBanco =
  | { status: 'aberto' }
  | { status: 'chave-necessaria'; spreadsheetId: string; title: string }
  | { status: 'erro' }

/** Contexto de sessão exposto pelo `AuthProvider`. */
export interface AuthContextValue {
  /**
   * Estado da sessão: `loading` (restaurando), `unauthenticated` (sem sessão),
   * `authenticated` (token válido), `local` (planilha persistida sem token
   * válido — o app opera com o cache e o login é solicitado sob demanda) ou
   * `bloqueado` (banco cifrado sem chave na sessão — a tela de desbloqueio
   * substitui qualquer conteúdo de dados).
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
  /**
   * Revoga o token e limpa a sessão/planilha persistida (também sai do modo
   * local). Esquece **todas** as chaves em memória; os verificadores de
   * desbloqueio offline permanecem no IndexedDB.
   */
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
   * Cria o banco padrão (as abas do schema) e o define como workspace.
   *
   * Antes de criar, verifica se já existe um banco com o mesmo nome. Quando
   * existe (e `options.force` não está ligado), devolve
   * `{ status: 'duplicate' }` sem criar nada, para que a UI pergunte ao usuário.
   *
   * Com `options.chave` o arquivo nasce cifrado, a sessão já fica desbloqueada e
   * o verificador de desbloqueio offline é gravado.
   */
  criarBanco: (
    title?: string,
    options?: OpcoesCriarBanco,
  ) => Promise<ResultadoCriacaoBanco>
  /**
   * Torna ativo um banco existente pelo id (planilha no Sheets ou arquivo no
   * Drive, conforme o backend), garantindo as abas do schema.
   *
   * Banco cifrado sem chave na sessão devolve `{ status: 'chave-necessaria' }`
   * sem trocar o workspace ativo e sem preencher `error` (não é falha).
   */
  abrirBancoPorId: (spreadsheetId: string) => Promise<ResultadoAberturaBanco>
  /**
   * Desbloqueia o banco cifrado com a senha do cofre.
   *
   * Online usa o arquivo do Drive (`desbloquear` do gateway, que guarda a chave
   * e deixa o cache pronto); offline/sem token usa o **verificador** gravado no
   * IndexedDB e segue em `local` com cache + outbox. `spreadsheetId` permite
   * desbloquear um banco que ainda não é o ativo (2º passo de "Abrir banco");
   * sem ele, desbloqueia o banco ativo.
   */
  desbloquearBanco: (senha: string, spreadsheetId?: string) => Promise<void>
  /**
   * Bloqueia o banco ativo: tenta esvaziar o outbox (melhor esforço), limpa o
   * cache de abas, esquece a chave e entra em `bloqueado`. Devolve quantas
   * alterações continuaram pendentes (não houve rede para enviá-las).
   */
  bloquearBanco: () => Promise<{ pendentes: number }>
  /**
   * "Esquecer este banco neste dispositivo": remove workspace, verificador e
   * chave e volta para `unauthenticated` (a próxima abertura lista os bancos).
   */
  esquecerBanco: () => void
  /**
   * Estado de criptografia do banco ativo (`'nenhuma'` quando o workspace ainda
   * não informa o dado — bancos criados antes da criptografia).
   */
  criptografiaDoBanco: CriptografiaBanco
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
