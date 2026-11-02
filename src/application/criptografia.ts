import { isOnline } from '@/application/online'
import { contarPendencias, sincronizarPendentes } from '@/application/sync'
import { validarChave } from '@/domain/criptografia'
import type { RepositoryContext } from '@/domain/repositories/ports'
import type { CriptografiaBanco } from '@/domain/workspace'
import { invalidateSpreadsheetCache } from '@/infrastructure/cache'
import { esquecerChave, obterChave } from '@/infrastructure/cripto/chaveSessao'
import { ChaveNecessariaError, criarSessao } from '@/infrastructure/cripto/envelope'
import { esquecerVerificador, guardarVerificador } from '@/infrastructure/cripto/verificadorLocal'
import { isCriptografiaSuportada } from '@/infrastructure/cripto/webCrypto'
import { isJsonBackend } from '@/infrastructure/googleConfig'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import {
  alterarCriptografia as alterarCriptografiaNoGateway,
  criptografiaDisponivel,
  estadoCriptografia,
} from '@/infrastructure/sheets/gatewayRouter'

/**
 * Casos de uso da criptografia do banco (`PLANO_CRIPTOGRAFIA.md` §5.5, §6.2–6.4).
 *
 * A apresentação não conhece gateway, fila nem Web Crypto: chama uma destas
 * funções e mostra `erro.message` — por isso as mensagens da §6.7 moram aqui e
 * cada pré-condição falha com `ErroCriptografiaIndisponivel` já pronta para a
 * tela. Desbloquear/abrir o banco continuam no `AuthProvider` (é estado de
 * sessão); aqui ficam só as operações de **configuração** e o bloqueio.
 */

export { ChaveIncorretaError, ChaveNecessariaError } from '@/infrastructure/cripto/envelope'

/** Sem Web Crypto não há cifra possível (o contexto não é seguro). */
export const MSG_WEB_CRYPTO_INDISPONIVEL =
  'Seu navegador não suporta criptografia neste contexto (é necessário HTTPS).'

/** No Google Sheets as células precisam ficar legíveis para as fórmulas. */
export const MSG_BACKEND_SHEETS =
  'Disponível no cofre JSON e no modo local; no Google Sheets as células precisam ficar legíveis.'

/** Alterar a cifra exige regravar o arquivo no Drive. */
export const MSG_OFFLINE = 'Conecte-se à internet para alterar a criptografia.'

/** Regravar com a fila pendente perderia alterações ainda não gravadas. */
export const MSG_FILA_PENDENTE = 'Sincronize as alterações pendentes antes de alterar a criptografia.'

/** Situação do arquivo/abas do banco ativo, junto da possibilidade de operar. */
export interface EstadoDoBanco {
  estado: CriptografiaBanco
  /** `true` quando o banco está cifrado e esta sessão ainda não tem a chave. */
  bloqueado: boolean
  /** `true` quando este navegador/backend consegue cifrar o banco. */
  disponivel: boolean
}

/** Operação de criptografia recusada por uma pré-condição (§6.7). */
export class ErroCriptografiaIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroCriptografiaIndisponivel'
  }
}

/** Dependências do bloqueio (injetáveis nos testes e pelo `AuthProvider`). */
export interface DependenciasBloqueio {
  /**
   * Obtém/renova o token antes do flush. `null` significa "sem token agora" —
   * a fila permanece e é enviada depois do desbloqueio.
   */
  obterToken?: () => Promise<string | null>
  /** Flush da fila (padrão: `sincronizarPendentes`). */
  sincronizar?: typeof sincronizarPendentes
}

/**
 * Estado real do arquivo (ou das abas locais), lido sem precisar da chave.
 *
 * No backend `sheets` o gateway responde "sem criptografia" sem tocar a rede; no
 * cofre JSON a resposta vem do magic dos bytes e, no modo local, da presença do
 * cofre no IndexedDB.
 */
export async function estadoDoBanco(context: RepositoryContext): Promise<EstadoDoBanco> {
  const { estado, bloqueado } = await estadoCriptografia(
    context.accessToken,
    context.spreadsheetId,
  )
  return { estado, bloqueado, disponivel: criptografiaDisponivel() }
}

/**
 * Por que a criptografia não pode ser usada agora (`null` = pode).
 *
 * É a única fonte da explicação exibida ao lado do toggle desabilitado — a UI
 * não repete as regras do backend nem do contexto seguro.
 */
export function motivoCriptografiaIndisponivel(): string | null {
  if (!isCriptografiaSuportada()) return MSG_WEB_CRYPTO_INDISPONIVEL
  // O modo local tem cofre próprio no IndexedDB (Fase 6); só o Sheets não cifra.
  if (!isModoLocal() && !isJsonBackend()) return MSG_BACKEND_SHEETS
  return null
}

/**
 * Liga a criptografia: deriva a chave, regrava o arquivo cifrado e grava o
 * verificador que permite desbloquear offline nas próximas sessões.
 */
export async function ativarCriptografia(
  context: RepositoryContext,
  senha: string,
): Promise<void> {
  exigirDisponibilidade()
  // Senha em branco é recusada antes da derivação (mensagem §6.7).
  validarChave(senha)
  exigirOnlineComFilaVazia()

  const sessao = await criarSessao(senha)
  await alterarCriptografiaNoGateway(context.accessToken, context.spreadsheetId, sessao)
  // Sem o verificador, o próximo reload exigiria internet para desbloquear.
  await guardarVerificador(context.spreadsheetId, sessao)
}

/**
 * Desliga a criptografia regravando o arquivo em claro.
 *
 * A chave **não** é pedida de novo: ela já está na sessão (o banco precisa
 * estar desbloqueado para regravar). Por isso a pré-condição é `obterChave`.
 */
export async function desativarCriptografia(context: RepositoryContext): Promise<void> {
  exigirDisponibilidade()
  if (!obterChave(context.spreadsheetId)) throw new ChaveNecessariaError()
  exigirOnlineComFilaVazia()

  await alterarCriptografiaNoGateway(context.accessToken, context.spreadsheetId, null)
  esquecerChave(context.spreadsheetId)
  esquecerVerificador(context.spreadsheetId)
}

/**
 * "Bloquear agora" (§6.4): tenta esvaziar a fila (melhor esforço), limpa o
 * cache de abas em claro, esquece a chave e informa quantas alterações
 * continuaram pendentes (serão enviadas após o desbloqueio).
 */
export async function bloquearBanco(
  context: RepositoryContext,
  deps: DependenciasBloqueio = {},
): Promise<{ pendentes: number }> {
  const sincronizar = deps.sincronizar ?? sincronizarPendentes

  if (!isModoLocal() && isOnline() && contarPendencias() > 0) {
    try {
      const token = deps.obterToken ? await deps.obterToken() : context.accessToken
      if (token) {
        await sincronizar(
          { ...context, accessToken: token },
          { obterToken: deps.obterToken },
        )
      }
    } catch {
      // Melhor esforço: a fila fica para depois do desbloqueio.
    }
  }

  // O cache de abas fica em claro no IndexedDB: não pode sobreviver ao bloqueio.
  invalidateSpreadsheetCache(context.spreadsheetId)
  esquecerChave(context.spreadsheetId)

  return { pendentes: contarPendencias() }
}

/** Backend/contexto capaz de cifrar ou a mensagem exata do porquê (§6.7). */
function exigirDisponibilidade(): void {
  const motivo = motivoCriptografiaIndisponivel()
  if (motivo) throw new ErroCriptografiaIndisponivel(motivo)
}

/** Regravar o arquivo exige internet e uma fila já gravada. */
function exigirOnlineComFilaVazia(): void {
  // Modo local: não há nuvem nem outbox a perder — a decisão do plano é
  // "Local: funciona offline".
  if (isModoLocal()) return
  if (!isOnline()) throw new ErroCriptografiaIndisponivel(MSG_OFFLINE)
  if (contarPendencias() > 0) throw new ErroCriptografiaIndisponivel(MSG_FILA_PENDENTE)
}
