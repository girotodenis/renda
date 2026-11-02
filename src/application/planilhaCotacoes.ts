/**
 * Casos de uso da **planilha de cotações** expostos à UI (§6.5 do plano).
 *
 * A autorização é sempre **explícita**: o app nunca pede o escopo da Sheets API
 * por conta própria. Sem autorização (ou com falha), as cotações seguem pelas
 * APIs e o dashboard não muda.
 */

import {
  estadoPlanilhaGoogle,
  integracaoPlanilhaGoogle,
  marcarPlanilhaGoogleDesconectada,
  resetEstadoPlanilhaGoogle,
} from '@/infrastructure/cotacoes/planilhaGoogle'
import type { EstadoPlanilhaGoogle } from '@/infrastructure/cotacoes/planilhaGoogle'
import { limparPlanilhaCotacoes } from '@/infrastructure/cotacoes/planilhaGoogle/planilha'
import {
  MISSING_CLIENT_ID_MESSAGE,
  SCOPES_COM_PLANILHA,
  googleConfig,
} from '@/infrastructure/googleConfig'
import { isUserCancellation, requestAccessToken, toStoredToken } from '@/infrastructure/googleIdentity'
import { tokenStorage } from '@/infrastructure/storage'

/** Mensagem pronta para quando o escopo da planilha não foi concedido. */
export const MSG_PLANILHA_NAO_AUTORIZADA =
  'Planilha de cotações não autorizada. As cotações usam as APIs.'

/** Estado exibido no card de Configurações. */
export interface EstadoPlanilhaCotacoes {
  estado: EstadoPlanilhaGoogle
  motivo: string | null
}

/** Resultado da autorização explícita (nenhum caminho lança). */
export type ResultadoAutorizacaoPlanilha =
  | { status: 'autorizada' }
  | { status: 'negada' }
  | { status: 'erro'; mensagem: string }

/**
 * Estado atual da integração.
 *
 * A checagem local do escopo decide entre "não autorizada" e "ativa" — o card
 * fica correto logo após o consentimento, sem depender de um ciclo do
 * dashboard. O estado também memoriza falhas (`indisponivel`) e uma
 * desconexão explícita na sessão.
 */
export function estadoPlanilhaCotacoes(): EstadoPlanilhaCotacoes {
  return estadoPlanilhaGoogle()
}

/**
 * Pede o consentimento incremental do escopo da Sheets API.
 *
 * `prompt: 'consent'` força a tela de consentimento (é uma ação explícita do
 * usuário). Cancelar não quebra nada: o estado fica `nao-autorizada` e o app
 * não insiste.
 */
export async function autorizarPlanilhaCotacoes(): Promise<ResultadoAutorizacaoPlanilha> {
  const clientId = googleConfig.clientId
  if (!clientId) return { status: 'erro', mensagem: MISSING_CLIENT_ID_MESSAGE }

  try {
    const resposta = await requestAccessToken({
      clientId,
      scopes: SCOPES_COM_PLANILHA,
      prompt: 'consent',
    })
    tokenStorage.save(toStoredToken(resposta))
    resetEstadoPlanilhaGoogle()
    return { status: 'autorizada' }
  } catch (error) {
    if (isUserCancellation(error)) {
      resetEstadoPlanilhaGoogle()
      return { status: 'negada' }
    }
    return {
      status: 'erro',
      mensagem:
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'Não foi possível autorizar a planilha de cotações.',
    }
  }
}

/**
 * Esquece a planilha de cotações: id salvo, cache e estado memorizado.
 *
 * O token **não** é revogado — ele continua válido para o banco, e revogar
 * derrubaria a sessão inteira.
 */
export function desconectarPlanilhaCotacoes(): void {
  limparPlanilhaCotacoes()
  integracaoPlanilhaGoogle.limparCache()
  // O token mantém o escopo, então a desconexão precisa ser explícita: sem
  // isso o próximo sync recriaria a planilha sem o usuário pedir.
  marcarPlanilhaGoogleDesconectada()
}
