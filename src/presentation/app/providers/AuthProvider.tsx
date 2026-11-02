import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from '@/presentation/app/providers/authContext'
import type {
  AuthContextValue,
  OpcoesCriarBanco,
  ResultadoAberturaBanco,
  ResultadoCriacaoBanco,
} from '@/presentation/app/providers/authContext'
import {
  ativarCriptografia as ativarCriptografiaApp,
  bloquearBanco as bloquearBancoApp,
  desativarCriptografia as desativarCriptografiaApp,
} from '@/application/criptografia'
import { isOnline } from '@/application/online'
import { contarPendencias } from '@/application/sync'
import { migrarPlanilhaAntiga as migrarPlanilhaAntigaApp, detectarBancoLegado } from '@/application/migrarPlanilha'
import type { OpcoesMigracao, ResultadoMigracao } from '@/application/migrarPlanilha'
import { validarChave } from '@/domain/criptografia'
import {
  isWorkspaceLocal,
  MODO_ARMAZENAMENTO_PADRAO,
  MODO_LOCAL,
  TOKEN_MODO_LOCAL,
  WORKSPACE_LOCAL_ID,
} from '@/domain/armazenamento'
import type { ModoArmazenamento } from '@/domain/armazenamento'
import {
  getModoArmazenamento,
  isModoLocal,
  setModoArmazenamento,
} from '@/infrastructure/modoArmazenamento'
import { tokenStorage, workspaceStorage, migracaoStorage, pastaAppStorage } from '@/infrastructure/storage'
import {
  esquecerChave,
  esquecerTodasAsChaves,
  guardarChave,
  obterChave,
  temChave,
} from '@/infrastructure/cripto/chaveSessao'
import { abrirVerificador, guardarVerificador, esquecerVerificador } from '@/infrastructure/cripto/verificadorLocal'
import { temCofreLocal } from '@/infrastructure/cripto/localCofre'
import { clearLocalSheets } from '@/infrastructure/sheets/localSheets'
import {
  ensureAppFolder,
  findAppFolder,
  findSpreadsheetsByName,
  GoogleDriveError,
  GooglePickerError,
  listAppSpreadsheets,
  moveFileToFolder,
  pickSpreadsheet,
  urlPastaDoApp,
} from '@/infrastructure/drive'
import {
  GOOGLE_SCOPES,
  SCOPES_COM_PLANILHA,
  SHEETS_SCOPE,
  googleConfig,
  isGoogleConfigured,
  isJsonBackend,
  isSpreadsheetPickerConfigured,
  MISSING_CLIENT_ID_MESSAGE,
  MISSING_PICKER_KEY_MESSAGE,
  tokenTemEscopo,
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
  ChaveIncorretaError,
  ChaveNecessariaError,
  abrirWorkspace,
  criarWorkspace,
  desbloquear as desbloquearWorkspace,
  estadoCriptografia,
  listarBancosDisponiveis,
  listarBancosExistentes,
  prepararWorkspaceLocal,
  SheetsApiError,
} from '@/infrastructure/sheets/gatewayRouter'
import type { EstadoCriptografia } from '@/infrastructure/sheets/gatewayRouter'
import type {
  AuthStatus,
  CriptografiaBanco,
  PlanilhaExistente,
  SpreadsheetWorkspace,
} from '@/domain/workspace'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Move o banco recém-criado (planilha ou arquivo JSON) para a pasta padrão do app
 * (`databases_app_minhas_acoes`), criando a pasta se necessário. Best-effort: usa apenas o
 * escopo `drive.file` (sem novas permissões) e, se falhar, o banco permanece
 * válido na raiz do Drive.
 */
async function organizarNaPastaDoApp(accessToken: string, spreadsheetId: string): Promise<void> {
  try {
    const folderId = await ensureAppFolder(accessToken)
    pastaAppStorage.save(urlPastaDoApp(folderId))
    await moveFileToFolder(accessToken, spreadsheetId, folderId)
  } catch {
    // Organização é cosmética; qualquer falha não impede o uso do banco.
  }
}

/**
 * Garante a pasta padrão do app (`databases_app_minhas_acoes`) para o Picker abrir direto
 * nela, criando-a se necessário. Best-effort: em falha devolve `null` e o Picker
 * abre no modo padrão.
 */
async function garantirPastaDoApp(accessToken: string): Promise<string | null> {
  try {
    const folderId = await ensureAppFolder(accessToken)
    // Guarda a URL: o botão "Abrir no Google Drive" abre a pasta, não o arquivo.
    pastaAppStorage.save(urlPastaDoApp(folderId))
    return folderId
  } catch {
    return null
  }
}

function describeError(error: unknown): string {
  if (error instanceof SheetsApiError) {
    if (error.status === 401) return 'Sessão expirada. Faça login novamente.'
    if (error.status === 403) {
      return 'Permissão negada pelo Google. Verifique se as APIs necessárias estão habilitadas e se os escopos foram autorizados.'
    }
    if (error.status === 429) return 'Cota da API do Google excedida. Tente novamente em instantes.'
    if (error.status === 412) return error.message
    return error.message.length > 0 ? error.message : 'Erro ao acessar o banco de dados no Google.'
  }
  if (error instanceof GooglePickerError || error instanceof GoogleAuthError || error instanceof GoogleDriveError) {
    return error.message
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

/** Mensagem única de chave errada (§6.7): nunca revelar qual byte falhou. */
const CHAVE_INCORRETA = 'Chave incorreta. Verifique e tente novamente.'

/** Título usado quando o nome do banco travado não é conhecido na sessão. */
const TITULO_BANCO_DESCONHECIDO = 'Banco protegido'

/**
 * `true` quando o banco está cifrado e a sessão não tem a chave.
 *
 * É a única condição que pode bloquear o app: sem ela o cache de abas em claro
 * apareceria antes de o usuário provar que sabe a senha (§6.4).
 */
function bancoBloqueado(banco: SpreadsheetWorkspace | null): boolean {
  return Boolean(
    banco && banco.criptografia === 'total' && !temChave(banco.spreadsheetId),
  )
}

/**
 * Status coerente com o banco ativo: `authenticated`/`local` **nunca** valem
 * enquanto o banco cifrado estiver sem chave.
 */
function statusDoBanco(
  banco: SpreadsheetWorkspace | null,
  base: Exclude<AuthStatus, 'loading' | 'bloqueado'>,
): AuthStatus {
  return bancoBloqueado(banco) ? 'bloqueado' : base
}

/**
 * Provider de sessão: gerencia login OAuth (GIS), o banco ativo e o **modo de
 * armazenamento** (nuvem — planilha do Sheets ou arquivo JSON no Drive,
 * conforme `VITE_GOOGLE_BACKEND` — ou banco local do navegador). O token é
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
  /**
   * Títulos conhecidos dos bancos (id → nome), preenchidos pelas listagens.
   * Usado para nomear o banco na tela de bloqueio ao abrir pela lista.
   */
  const titulosRef = useRef(new Map<string, string>())

  const applyToken = useCallback((response: GoogleTokenResponse) => {
    const stored = toStoredToken(response)
    tokenStorage.save(stored)
    tokenRef.current = stored.accessToken
    setAccessToken(stored.accessToken)
    // Banco cifrado sem chave continua bloqueado mesmo com token novo.
    setStatus(statusDoBanco(workspaceStorage.load(), 'authenticated'))
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

    // Preserva o escopo da planilha de cotações quando ele já foi concedido:
    // renovar só com `GOOGLE_SCOPES` revogaria o acesso à planilha a cada hora.
    const anterior = tokenStorage.load()
    const scopes =
      anterior && tokenTemEscopo(anterior.scope, SHEETS_SCOPE) ? SCOPES_COM_PLANILHA : GOOGLE_SCOPES

    try {
      const response = await requestAccessToken({ clientId, scopes, prompt: '' })
      applyToken(response)
      return true
    } catch {
      // Falha real ou transitória (sem sessão Google ativa, cookies de
      // terceiros bloqueados, consentimento revogado): não desloga — apenas
      // informa ao chamador que não há token disponível.
      const banco = workspaceStorage.load()
      setStatus(banco ? statusDoBanco(banco, 'local') : 'unauthenticated')
      return false
    }
  }, [applyToken])

  // Bootstrap da sessão: entra direto, sem chamar o Google, sempre que
  // possível. No modo local, garante o banco do navegador e entra. Com
  // planilha configurada e token expirado/ausente, abre em modo local (dados do
  // cache) em vez de forçar o login.
  //
  // O bloqueio vem **antes** de qualquer leitura: banco cifrado sem chave na
  // sessão entra em `bloqueado` (a tela de desbloqueio é o único conteúdo).
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    if (isModoLocal()) {
      void (async () => {
        try {
          const stored = workspaceStorage.load()
          const local = stored && isWorkspaceLocal(stored.spreadsheetId) ? stored : null
          if (local) {
            // Já existe banco local persistido: preserva o estado (inclusive a
            // criptografia) em vez de recriar o workspace.
            setWorkspace(local)
            setStatus(statusDoBanco(local, 'local'))
            return
          }
          const workspaceLocal = await prepararWorkspaceLocal()
          workspaceStorage.save(workspaceLocal)
          setWorkspace(workspaceLocal)
          setStatus(statusDoBanco(workspaceLocal, 'local'))
        } catch {
          setError('Não foi possível abrir o banco de dados local deste navegador.')
          setStatus('unauthenticated')
        }
      })()
      return
    }

    if (!isGoogleConfigured()) {
      // Banco persistido (inclusive cifrado, desbloqueável pelo verificador)
      // continua utilizando o fluxo normal mesmo sem Client ID configurado.
      const banco = workspaceStorage.load()
      setStatus(banco ? statusDoBanco(banco, 'local') : 'unauthenticated')
      return
    }

    const stored = tokenStorage.load()
    if (stored && isTokenValid(stored)) {
      tokenRef.current = stored.accessToken
      setAccessToken(stored.accessToken)
      setStatus(statusDoBanco(workspaceStorage.load(), 'authenticated'))
      return
    }

    const banco = workspaceStorage.load()
    setStatus(banco ? statusDoBanco(banco, 'local') : 'unauthenticated')
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
      // Chaves são por banco: sair do Google esquece a chave do banco anterior.
      const anterior = workspaceStorage.load()?.spreadsheetId
      if (anterior && anterior !== WORKSPACE_LOCAL_ID) esquecerChave(anterior)

      // Banco local já persistido é preservado (inclusive o estado de cifra);
      // recriá-lo perderia a marca de criptografia.
      const atual = workspaceStorage.load()
      const localAtual = atual && isWorkspaceLocal(atual.spreadsheetId) ? atual : null
      const workspaceLocal = localAtual ?? (await prepararWorkspaceLocal())
      setModoArmazenamento(MODO_LOCAL)
      setModo(MODO_LOCAL)
      workspaceStorage.save(workspaceLocal)
      setWorkspace(workspaceLocal)
      setStatus(statusDoBanco(workspaceLocal, 'local'))
    } catch {
      setError('Não foi possível ativar o modo local neste navegador.')
    } finally {
      setIsBusy(false)
    }
  }, [])

  const login = useCallback(async () => {
    if (!googleConfig.clientId) {
      setError(MISSING_CLIENT_ID_MESSAGE)
      const banco = workspaceStorage.load()
      setStatus(banco ? statusDoBanco(banco, 'local') : 'unauthenticated')
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
          esquecerChave(stored.spreadsheetId)
          workspaceStorage.clear()
          setWorkspace(null)
        }
      }
      setStatus(statusDoBanco(workspaceStorage.load(), 'authenticated'))

      // Backend JSON: se ainda não há banco ativo neste navegador e existe
      // exatamente um banco no Drive, abre-o automaticamente. Com 0 ou 2+,
      // o usuário escolhe na tela de criação/abertura (lista de bancos).
      const token = tokenRef.current
      if (isJsonBackend() && token && !workspaceStorage.load()) {
        try {
          const bancos = await listarBancosDisponiveis(token)
          for (const banco of bancos) titulosRef.current.set(banco.spreadsheetId, banco.title)
          const unico = bancos.length === 1 ? bancos[0] : undefined
          if (unico) {
            const carregado = await abrirWorkspace(token, unico.spreadsheetId)
            workspaceStorage.save(carregado)
            setWorkspace(carregado)
            setStatus(statusDoBanco(carregado, 'authenticated'))
          }
        } catch {
          // Sem abrir automaticamente (inclusive banco cifrado sem chave): a
          // tela de criação/abertura continua disponível.
        }
      }
    } catch (loginError) {
      const banco = workspaceStorage.load()
      setStatus(banco ? statusDoBanco(banco, 'local') : 'unauthenticated')
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
    // Logout esquece **todas** as chaves em memória. Os verificadores de
    // desbloqueio offline ficam: só saem ao desativar a criptografia ou em
    // "Esquecer este banco" (§3.3).
    esquecerTodasAsChaves()
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

  /**
   * Chaves são **por banco**: mudar de banco (lista, Picker, modo local, login)
   * esquece a chave do anterior.
   */
  const esquecerChaveDoBancoAnterior = useCallback((proximoId: string | null) => {
    const atual = workspaceStorage.load()?.spreadsheetId
    if (atual && atual !== proximoId) esquecerChave(atual)
  }, [])

  const salvarWorkspace = useCallback((loaded: SpreadsheetWorkspace) => {
    // A pasta do app é da conta, não do banco: ao abrir um banco criado antes de
    // essa informação existir, preserva a URL da pasta já conhecida.
    const pastaUrl = loaded.pastaUrl ?? workspaceStorage.load()?.pastaUrl ?? pastaAppStorage.load()
    const salvo: SpreadsheetWorkspace = pastaUrl ? { ...loaded, pastaUrl } : loaded
    workspaceStorage.save(salvo)
    setWorkspace(salvo)
    // Banco cifrado recém-aberto só chega aqui quando já desbloqueado.
    setStatus(
      statusDoBanco(salvo, isModoLocal() || !tokenRef.current ? 'local' : 'authenticated'),
    )
  }, [])

  const listarBancos = useCallback(async (): Promise<PlanilhaExistente[]> => {
    setError(null)
    if (isModoLocal()) {
      setError(
        'Você está no modo local (sem Google). Saia do modo local para usar um banco de dados no Google.',
      )
      return []
    }

    const token = await ensureAccessToken()
    if (!token) {
      // Sem token: `ensureAccessToken` já ajustou o status (modo local quando
      // há banco persistido); basta avisar o usuário.
      setError('Sessão expirada. Faça login novamente.')
      return []
    }

    setIsBusy(true)
    try {
      const bancos = isJsonBackend()
        ? await listarBancosDisponiveis(token)
        : await listAppSpreadsheets(token)
      // Guarda os nomes: o banco cifrado não abre, mas a tela de bloqueio
      // precisa do nome dele.
      for (const banco of bancos) titulosRef.current.set(banco.spreadsheetId, banco.title)
      return bancos
    } catch (listError) {
      setError(describeError(listError))
      return []
    } finally {
      setIsBusy(false)
    }
  }, [ensureAccessToken])

  const abrirPlanilhaNoPicker = useCallback(async () => {
    setError(null)
    if (isModoLocal()) {
      setError(
        'Você está no modo local (sem Google). Saia do modo local para usar um banco de dados no Google.',
      )
      return
    }
    if (!isSpreadsheetPickerConfigured()) {
      setError(MISSING_PICKER_KEY_MESSAGE)
      return
    }

    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return
    }

    setIsBusy(true)
    try {
      const folderId = await garantirPastaDoApp(token)
      const picked = await pickSpreadsheet(token, { folderId })
      if (!picked) return
      const loaded = await abrirWorkspace(token, picked.spreadsheetId)
      esquecerChaveDoBancoAnterior(loaded.spreadsheetId)
      salvarWorkspace(loaded)
    } catch (selectionError) {
      setError(describeError(selectionError))
    } finally {
      setIsBusy(false)
    }
  }, [ensureAccessToken, esquecerChaveDoBancoAnterior, salvarWorkspace])

  const abrirBancoPorId = useCallback(
    async (spreadsheetId: string): Promise<ResultadoAberturaBanco> => {
      setError(null)
      if (isModoLocal()) {
        setError(
          'Você está no modo local (sem Google). Saia do modo local para usar um banco de dados no Google.',
        )
        return { status: 'erro' }
      }
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        return { status: 'erro' }
      }

      setIsBusy(true)
      try {
        const loaded = await abrirWorkspace(token, spreadsheetId)
        esquecerChaveDoBancoAnterior(loaded.spreadsheetId)
        salvarWorkspace(loaded)
        return { status: 'aberto' }
      } catch (openError) {
        if (openError instanceof ChaveNecessariaError) {
          // Resultado esperado, não erro: o banco ativo **não** muda e a UI
          // pede a senha (2º passo de "Abrir banco", §6.8).
          return {
            status: 'chave-necessaria',
            spreadsheetId,
            title: titulosRef.current.get(spreadsheetId) ?? TITULO_BANCO_DESCONHECIDO,
          }
        }
        setError(describeError(openError))
        return { status: 'erro' }
      } finally {
        setIsBusy(false)
      }
    },
    [ensureAccessToken, esquecerChaveDoBancoAnterior, salvarWorkspace],
  )

  /**
   * Valida a senha **sem rede** com o verificador gravado no IndexedDB.
   * É o caminho do modo local e do desbloqueio offline (§3.3, decisão 10).
   */
  const desbloquearComVerificador = useCallback(async (id: string, senha: string) => {
    const sessao = await abrirVerificador(id, senha)
    if (!sessao) {
      setError(CHAVE_INCORRETA)
      return
    }
    guardarChave(id, sessao)
    const ativo = workspaceStorage.load()
    if (ativo && ativo.spreadsheetId === id) {
      // Offline continua em `local`: cache + outbox, sincronizando ao reconectar.
      setStatus(statusDoBanco(ativo, 'local'))
    }
  }, [])

  const desbloquearBanco = useCallback(
    async (senha: string, spreadsheetId?: string) => {
      setError(null)
      const alvo = spreadsheetId ?? workspaceStorage.load()?.spreadsheetId ?? null
      if (!alvo) {
        setError('Nenhum banco selecionado para desbloquear.')
        return
      }

      setIsBusy(true)
      try {
        // Senha em branco é recusada antes de qualquer derivação (mensagem §6.7).
        try {
          validarChave(senha)
        } catch (senhaInvalida) {
          setError(describeError(senhaInvalida))
          return
        }

        // Modo local ou sem internet: nada vai para a rede.
        if (isModoLocal() || !isOnline()) {
          await desbloquearComVerificador(alvo, senha)
          return
        }

        const token = await ensureAccessToken()
        if (!token) {
          // Sem token (status `local`): a senha é conferida pelo verificador.
          await desbloquearComVerificador(alvo, senha)
          return
        }

        const aberto = await desbloquearWorkspace(token, alvo, senha)
        // O verificador habilita o próximo desbloqueio sem internet. Falhar aqui
        // é aceitável (o banco já está aberto): é só uma conveniência.
        const sessao = obterChave(alvo)
        if (sessao) {
          try {
            await guardarVerificador(alvo, sessao)
          } catch {
            // Sem verificador: o próximo desbloqueio exigirá internet.
          }
        }
        esquecerChaveDoBancoAnterior(alvo)
        salvarWorkspace(aberto)
      } catch (erro) {
        if (erro instanceof ChaveIncorretaError) {
          // Não altera o workspace ativo nem guarda chave (§6.1, passo 5).
          setError(CHAVE_INCORRETA)
        } else if (erro instanceof ChaveNecessariaError) {
          setError(erro.message)
        } else {
          setError(describeError(erro))
        }
      } finally {
        setIsBusy(false)
      }
    },
    [desbloquearComVerificador, ensureAccessToken, esquecerChaveDoBancoAnterior, salvarWorkspace],
  )

  /**
   * "Bloquear agora": delega o flush/cache/chave ao caso de uso e entra em
   * `bloqueado` (§6.4). Pendências sem rede permanecem na fila e voltam a ser
   * enviadas após o desbloqueio.
   */
  const bloquearBanco = useCallback(async (): Promise<{ pendentes: number }> => {
    setError(null)
    const ativo = workspaceStorage.load()
    if (!ativo) return { pendentes: contarPendencias() }

    const resultado = await bloquearBancoApp(
      { accessToken: tokenRef.current ?? '', spreadsheetId: ativo.spreadsheetId },
      {
        obterToken: async () => {
          if (isModoLocal() || !isOnline()) return null
          return ensureAccessToken()
        },
      },
    )

    // Só um banco cifrado faz sentido bloquear; num banco em claro a ação foi
    // apenas limpeza de cache/chaves e o status atual permanece.
    setStatus((atual) => (bancoBloqueado(ativo) ? 'bloqueado' : atual))

    return resultado
  }, [ensureAccessToken])

  /**
   * Liga a criptografia do banco ativo (§6.2). Ao terminar o banco continua
   * desbloqueado: a chave recém-derivada fica em memória nesta sessão.
   */
  const ativarCriptografia = useCallback(
    async (senha: string) => {
      setError(null)
      const ativo = workspaceStorage.load()
      if (!ativo) {
        setError('Nenhum banco selecionado para criptografar.')
        return
      }

      setIsBusy(true)
      try {
        const token = await ensureAccessToken()
        if (!token && !isModoLocal()) {
          setError('Sessão expirada. Faça login novamente.')
          return
        }
        await ativarCriptografiaApp(
          { accessToken: token ?? TOKEN_MODO_LOCAL, spreadsheetId: ativo.spreadsheetId },
          senha,
        )
        salvarWorkspace({ ...ativo, criptografia: 'total' })
      } catch (criptoError) {
        setError(describeError(criptoError))
      } finally {
        setIsBusy(false)
      }
    },
    [ensureAccessToken, salvarWorkspace],
  )

  /**
   * Desliga a criptografia do banco ativo (§6.2). Não pede a senha: a chave já
   * está na sessão e o arquivo volta a ser legível.
   */
  const desativarCriptografia = useCallback(async () => {
    setError(null)
    const ativo = workspaceStorage.load()
    if (!ativo) {
      setError('Nenhum banco selecionado para alterar a criptografia.')
      return
    }

    setIsBusy(true)
    try {
      const token = await ensureAccessToken()
      if (!token && !isModoLocal()) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      await desativarCriptografiaApp({
        accessToken: token ?? TOKEN_MODO_LOCAL,
        spreadsheetId: ativo.spreadsheetId,
      })
      // `nenhuma` também libera o status: a chave acabou de ser esquecida.
      salvarWorkspace({ ...ativo, criptografia: 'nenhuma' })
    } catch (criptoError) {
      setError(describeError(criptoError))
    } finally {
      setIsBusy(false)
    }
  }, [ensureAccessToken, salvarWorkspace])

  /**
   * Relê o estado real do arquivo (magic/abas) e sincroniza o workspace ativo.
   *
   * Serve para o card de Configurações não confiar só no metadado persistido —
   * outro dispositivo pode ter cifrado o banco. Falha (offline, sem token) é
   * silenciosa: devolve `null` e a UI mantém o último estado conhecido.
   */
  const recarregarEstadoCriptografia = useCallback(async (): Promise<EstadoCriptografia | null> => {
    const ativo = workspaceStorage.load()
    if (!ativo) return null

    const token = tokenRef.current ?? (await ensureAccessToken())
    try {
      const resultado = await estadoCriptografia(
        token ?? TOKEN_MODO_LOCAL,
        ativo.spreadsheetId,
      )
      const atualizado: SpreadsheetWorkspace = {
        ...ativo,
        criptografia: resultado.estado,
      }
      if (ativo.criptografia !== resultado.estado) salvarWorkspace(atualizado)
      return resultado
    } catch {
      return null
    }
  }, [ensureAccessToken, salvarWorkspace])

  /** "Esquecer este banco": remove workspace, verificador e chaves deste dispositivo. */
  const esquecerBanco = useCallback(() => {
    const ativo = workspaceStorage.load()
    // No modo local o cofre é o único caminho para as abas cifradas: sem ele os
    // envelopes ficariam órfãos, então esquecer o banco também limpa as abas.
    const eraCofreLocal = Boolean(ativo && isWorkspaceLocal(ativo.spreadsheetId) && temCofreLocal())
    if (ativo) esquecerVerificador(ativo.spreadsheetId)
    if (eraCofreLocal) clearLocalSheets()
    // Nada permanece desbloqueado em memória depois de esquecer o banco.
    esquecerTodasAsChaves()
    workspaceStorage.clear()
    setWorkspace(null)
    setError(null)
    setStatus('unauthenticated')
  }, [])

  const criarBanco = useCallback(
    async (title?: string, options?: OpcoesCriarBanco): Promise<ResultadoCriacaoBanco> => {
      setError(null)
      if (isModoLocal()) {
        setError(
          'Você está no modo local (sem Google). Saia do modo local para usar um banco de dados no Google.',
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
            const existentes = isJsonBackend()
              ? await listarBancosExistentes(token, trimmed)
              : await findSpreadsheetsByName(token, trimmed)
            const [existente] = existentes
            if (existente) return { status: 'duplicate', existente }
          } catch {
            // Falha na verificação (rede/quota): segue com a criação. Os dois
            // backends aceitam nomes duplicados e bloquear o usuário seria pior.
          }
        }

        const chave = options?.chave ?? null
        // A pasta é garantida ANTES da criação: com `parents` o arquivo já nasce
        // dentro de `databases_app_minhas_acoes`. O "mover depois" era best-effort e podia
        // falhar em silêncio, deixando o banco na raiz do Drive.
        const folderId = isJsonBackend() ? await garantirPastaDoApp(token) : null
        const created = await criarWorkspace(token, title, {
          ...(chave ? { chave } : {}),
          folderId: folderId ?? undefined,
        })
        esquecerChaveDoBancoAnterior(created.spreadsheetId)
        salvarWorkspace(created)
        if (chave) {
          // Banco nasce desbloqueado (o gateway já guardou a chave); o
          // verificador só torna possível desbloquear offline depois.
          try {
            await guardarVerificador(created.spreadsheetId, chave)
          } catch {
            // Sem verificador: o próximo desbloqueio exigirá internet.
          }
        }
        // Só quando a pasta não pôde ser garantida antes (fallback do fallback).
        if (isJsonBackend() && !folderId) {
          await organizarNaPastaDoApp(token, created.spreadsheetId)
        }
        return { status: 'created' }
      } catch (creationError) {
        setError(describeError(creationError))
        return { status: 'error' }
      } finally {
        setIsBusy(false)
      }
    },
    [ensureAccessToken, esquecerChaveDoBancoAnterior, salvarWorkspace],
  )

  /**
   * Migra o banco ativo do formato antigo (planilha do Sheets) para o cofre
   * JSON (§6.6). O caso de uso só **lê** a planilha antiga; em sucesso o
   * workspace ativo passa a ser o cofre novo (já desbloqueado quando houve
   * chave, pois o gateway guarda a chave da sessão na criação).
   */
  const migrarPlanilhaAntiga = useCallback(
    async (opcoes?: OpcoesMigracao): Promise<ResultadoMigracao> => {
      setError(null)
      const ativo = workspaceStorage.load()

      if (isModoLocal()) {
        const mensagem =
          'Você está no modo local (sem Google). A migração se aplica a bancos salvos no Google.'
        setError(mensagem)
        return { status: 'erro', mensagem }
      }
      if (!ativo) {
        const mensagem = 'Nenhum banco selecionado para migrar.'
        setError(mensagem)
        return { status: 'erro', mensagem }
      }
      if (!detectarBancoLegado(ativo)) {
        const mensagem = 'Este banco já está no formato novo.'
        setError(mensagem)
        return { status: 'erro', mensagem }
      }

      const token = await ensureAccessToken()
      if (!token) {
        const mensagem = 'Sessão expirada. Faça login novamente.'
        setError(mensagem)
        return { status: 'erro', mensagem }
      }

      setIsBusy(true)
      try {
        const resultado = await migrarPlanilhaAntigaApp(
          { accessToken: token, spreadsheetId: ativo.spreadsheetId },
          { ...opcoes, title: ativo.title },
        )
        if (resultado.status === 'erro') {
          setError(resultado.mensagem)
          return resultado
        }

        // Chaves são por banco: a antiga não é mais usada por este workspace.
        esquecerChaveDoBancoAnterior(resultado.workspace.spreadsheetId)
        salvarWorkspace(resultado.workspace)

        if (opcoes?.chave) {
          // Mesma conveniência da criação: desbloquear offline depois é possível.
          try {
            await guardarVerificador(resultado.workspace.spreadsheetId, opcoes.chave)
          } catch {
            // Sem verificador: o próximo desbloqueio exigirá internet.
          }
        }

        // A oferta não volta nem para o banco antigo nem para o cofre novo.
        migracaoStorage.dispensar(ativo.spreadsheetId)
        return resultado
      } catch (migracaoError) {
        const mensagem = describeError(migracaoError)
        setError(mensagem)
        return { status: 'erro', mensagem }
      } finally {
        setIsBusy(false)
      }
    },
    [ensureAccessToken, esquecerChaveDoBancoAnterior, salvarWorkspace],
  )

  /** "Agora não": a oferta some só para o banco legado ativo. */
  const dispensarMigracao = useCallback(() => {
    const ativo = workspaceStorage.load()
    if (ativo) migracaoStorage.dispensar(ativo.spreadsheetId)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  /**
   * URL da pasta do app no Drive (`databases_app_minhas_acoes`) — destino do
   * botão "Abrir no Google Drive" no backend `json`.
   *
   * Devolve o valor já conhecido (workspace/cache do navegador) sem ir à rede.
   * Quando ele ainda não existe (bancos criados antes desta informação), busca
   * a pasta uma única vez com o escopo `drive.file` e passa a guardá-la. Nunca
   * cria nada: sem pasta (ou sem token/rede) devolve `null` e a UI cai para a
   * URL do arquivo do banco.
   */
  const obterUrlPastaDoApp = useCallback(async (): Promise<string | null> => {
    const conhecida = workspaceStorage.load()?.pastaUrl ?? pastaAppStorage.load()
    if (conhecida) return conhecida
    if (isModoLocal() || !isJsonBackend() || !isOnline()) return null

    const token = tokenRef.current ?? (await ensureAccessToken())
    if (!token) return null

    try {
      const folderId = await findAppFolder(token)
      if (!folderId) return null
      const url = urlPastaDoApp(folderId)
      pastaAppStorage.save(url)
      return url
    } catch {
      // Sem rede/quota/sessão expirada: o botão cai para a URL do arquivo.
      return null
    }
  }, [ensureAccessToken])

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
      listarBancos,
      abrirPlanilhaNoPicker,
      criarBanco,
      abrirBancoPorId,
      desbloquearBanco,
      bloquearBanco,
      esquecerBanco,
      criptografiaDoBanco: criptografiaDoBanco(workspace),
      ativarCriptografia,
      desativarCriptografia,
      recarregarEstadoCriptografia,
      migrarPlanilhaAntiga,
      dispensarMigracao,
      ensureAccessToken,
      obterUrlPastaDoApp,
      clearError,
    }),
    [
      abrirBancoPorId,
      abrirPlanilhaNoPicker,
      accessToken,
      ativarCriptografia,
      bloquearBanco,
      clearError,
      criarBanco,
      desativarCriptografia,
      desbloquearBanco,
      dispensarMigracao,
      ensureAccessToken,
      error,
      esquecerBanco,
      isBusy,
      listarBancos,
      login,
      logout,
      migrarPlanilhaAntiga,
      modo,
      obterUrlPastaDoApp,
      recarregarEstadoCriptografia,
      status,
      usarModoLocal,
      workspace,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Estado de criptografia do banco ativo (ausente = banco anterior à cifra). */
function criptografiaDoBanco(workspace: SpreadsheetWorkspace | null): CriptografiaBanco {
  return workspace?.criptografia ?? 'nenhuma'
}
