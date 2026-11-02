/**
 * Adaptador da **planilha de cotações** (Google Sheets + `GOOGLEFINANCE`) para
 * as portas de cotação do domínio.
 *
 * É a fonte **primária** de B3 quando autorizada — a planilha calcula os
 * preços e o app lê em lote. Qualquer falha (sem escopo, 403, planilha apagada,
 * rede) degrada para as APIs da cadeia, nunca lança e nunca insiste em pedir
 * autorização sozinha (§4.2 do plano).
 */

import type {
  CotacaoMercado,
  IntegracaoCotacao,
  OpcoesConsultaCotacoes,
  ResultadoCotacoes,
} from '@/domain/provedoresCotacao'
import {
  garantirPlanilha,
  lerCotacoes,
  reconciliarTickers,
} from '@/infrastructure/cotacoes/planilhaGoogle/planilha'
import { SHEETS_SCOPE, tokenTemEscopo } from '@/infrastructure/googleConfig'
import { kvDelete, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'
import { tokenStorage } from '@/infrastructure/storage'

export const PLANILHA_GOOGLE_ID = 'planilha-google'

/** Estados possíveis da integração durante a sessão. */
export type EstadoPlanilhaGoogle = 'ativa' | 'nao-autorizada' | 'indisponivel'

/** Estado + motivo exibidos no card de Configurações. */
export interface EstadoIntegracaoPlanilha {
  estado: EstadoPlanilhaGoogle
  motivo: string | null
}

/**
 * Estado memorizado na sessão (`null` = ainda não decidido → deriva do token
 * salvo). Evita repetir chamadas que já falharam e mantém a decisão de
 * "desconectado" mesmo que o token continue com o escopo.
 */
let estadoAtual: EstadoIntegracaoPlanilha | null = null

/** Estado derivado da checagem **local** do escopo do token salvo. */
function estadoDoToken(): EstadoIntegracaoPlanilha {
  const salvo = tokenStorage.load()
  const autorizado = salvo !== null && tokenTemEscopo(salvo.scope, SHEETS_SCOPE)
  return { estado: autorizado ? 'ativa' : 'nao-autorizada', motivo: null }
}

/** Estado atual da integração (sem fazer rede). */
export function estadoPlanilhaGoogle(): EstadoIntegracaoPlanilha {
  return estadoAtual ?? estadoDoToken()
}

/** Volta a decidir o estado pelo token salvo (nova autorização). */
export function resetEstadoPlanilhaGoogle(): void {
  estadoAtual = null
}

/**
 * Marca a planilha como desconectada nesta sessão: mesmo com o escopo no token,
 * o app não volta a usá-la até uma nova autorização explícita.
 */
export function marcarPlanilhaGoogleDesconectada(): void {
  estadoAtual = { estado: 'nao-autorizada', motivo: null }
}

/** Estado limpo para os testes. */
export function _resetEstadoForTests(): void {
  resetEstadoPlanilhaGoogle()
}

const CACHE_PREFIX = 'minhaacoes.planilha.v1.'

interface RegistroCache {
  cotacao: CotacaoMercado
  gravadoEm: number
}

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`
}

/** Dia local do instante informado (`YYYY-MM-DD`) — chave da validade do cache. */
function diaLocal(instante: number): string {
  const data = new Date(instante)
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

/** Cotação salva pela planilha **hoje** (`null` fora do dia ou inexistente). */
export function lerCotacaoPlanilhaCache(ticker: string): CotacaoMercado | null {
  const registro = kvGet<RegistroCache>('sheets', cacheKey(ticker))
  if (!registro || typeof registro.gravadoEm !== 'number') return null
  if (diaLocal(registro.gravadoEm) !== diaLocal(Date.now())) return null
  return { ...registro.cotacao, fonte: 'cache' }
}

function gravarCache(ticker: string, cotacao: CotacaoMercado): void {
  kvSet('sheets', cacheKey(ticker), { cotacao, gravadoEm: Date.now() })
}

/** Remove as cotações da planilha do cache local. */
export function clearPlanilhaCache(): void {
  for (const chave of kvKeys('sheets')) {
    if (chave.startsWith(CACHE_PREFIX)) kvDelete('sheets', chave)
  }
}

function resultadoSemTudo(tickers: readonly string[]): ResultadoCotacoes {
  return {
    cotacoes: new Map<string, CotacaoMercado>(),
    semCotacao: [...tickers],
    semToken: false,
    consultouRede: false,
  }
}

/** Mensagem do motivo quando a planilha responde com falha. */
function mensagemDoErro(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'Não foi possível ler a planilha de cotações.'
}

/**
 * Consulta a planilha: garante o arquivo, reconcilia os tickers e lê os preços
 * em uma requisição. Nunca lança.
 *
 * Sempre lê a planilha (uma chamada por sync, independente de `forceRefresh`):
 * os preços são intradiários e a planilha é a fonte primária. O cache existe
 * só para o modo offline (`lerCache`).
 */
async function atualizarCotacoesPlanilha(
  tickers: readonly string[],
  opcoes: OpcoesConsultaCotacoes,
): Promise<ResultadoCotacoes> {
  const normalizados = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()))].filter(
    (ticker) => ticker.length > 0,
  )
  if (normalizados.length === 0) {
    return {
      cotacoes: new Map<string, CotacaoMercado>(),
      semCotacao: [],
      semToken: false,
      consultouRede: false,
    }
  }

  const token = (opcoes.accessToken ?? '').trim()
  const estado = estadoPlanilhaGoogle()
  // Sem token (modo local/offline), sem escopo (`nao-autorizada`) ou com falha
  // já conhecida (`indisponivel`): nenhuma chamada de rede.
  if (token.length === 0 || estado.estado !== 'ativa') return resultadoSemTudo(normalizados)

  try {
    const spreadsheetId = await garantirPlanilha(token)
    await reconciliarTickers(token, spreadsheetId, normalizados)
    const lidas = await lerCotacoes(token, spreadsheetId, normalizados)
    const hoje = diaLocal(Date.now())

    const cotacoes = new Map<string, CotacaoMercado>()
    for (const [ticker, cotacao] of lidas) {
      const mercado: CotacaoMercado = {
        preco: cotacao.preco,
        precoAbertura: cotacao.abertura,
        atualizadoEm: hoje,
        fonte: 'api',
      }
      gravarCache(ticker, mercado)
      cotacoes.set(ticker, mercado)
      opcoes.aoConsultar?.(`planilha ${ticker}`)
    }

    estadoAtual = { estado: 'ativa', motivo: null }
    return {
      cotacoes,
      semCotacao: normalizados.filter((ticker) => !cotacoes.has(ticker)),
      semToken: false,
      consultouRede: true,
    }
  } catch (error) {
    estadoAtual = { estado: 'indisponivel', motivo: mensagemDoErro(error) }
    return resultadoSemTudo(normalizados)
  }
}

/** Adaptador da planilha de cotações para as portas de cotação do domínio. */
export const integracaoPlanilhaGoogle: IntegracaoCotacao = {
  id: PLANILHA_GOOGLE_ID,
  nome: 'Planilha Google (GOOGLEFINANCE)',
  site: 'https://docs.google.com/spreadsheets',
  // A autorização é uma ação explícita no card de Configurações, não um token
  // digitado — por isso não entra na lista de campos de token.
  exigeToken: false,
  b3: {
    lerCache: lerCotacaoPlanilhaCache,
    atualizar: atualizarCotacoesPlanilha,
  },
  limparCache() {
    clearPlanilhaCache()
    resetEstadoPlanilhaGoogle()
  },
}
