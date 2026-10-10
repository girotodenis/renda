import { isTesouroDireto } from '@/lib/categoria'
import { aplicarPrecosAtuais, calcularPosicoes, calcularResumo } from '@/lib/consolidado'
import type { PosicaoConsolidada, ResumoCarteira } from '@/lib/consolidado'
import {
  precosDeCotacoes,
  precosManuaisDeOperacoes,
  resolverCotacoes,
} from '@/lib/cotacoes'
import type { CotacaoResolvida, EntradaCotacao } from '@/lib/cotacoes'
import {
  consolidadoRepo,
  historicoRepo,
  operacoesRepo,
  prefetchAllSheets,
  proventosRepo,
} from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { registrarSnapshot } from '@/services/historico'
import { buscarCotacoesTesouro, lerCotacaoCache } from '@/services/tesouro'
import type { Consolidado, Operacao, Provento, Snapshot } from '@/types/domain'

/**
 * Orquestração de dados do dashboard (RF07–RF11, RF19, RNF02/RNF04/RNF06/RNF08).
 *
 * Estratégia **cache-first**: a leitura é sempre do cache local; a rede só é
 * acionada quando o cache está frio (uma única `batchGet`) ou em refresh
 * explícito. O consolidado é recalculado no app (`lib/consolidado`) com as
 * cotações resolvidas por categoria:
 * - Ação/FII/BDR: valor computado do `GOOGLEFINANCE` lido da aba `Consolidado`.
 * - Tesouro Direto: API de dados abertos (cache-first) → marcação manual.
 * - Renda Fixa: `Valor Bruto Atual` (marcação a mercado editável).
 *
 * Quando não há cotação, o preço médio é usado como fallback — sem travar a UI
 * (RNF04) — e o status fica `indisponivel` para a interface sinalizar.
 */

export interface DashboardData {
  consolidado: Consolidado[]
  resumo: ResumoCarteira
  /** Operações lançadas (base do detalhe por ativo — RF10). */
  operacoes: Operacao[]
  proventos: Provento[]
  historico: Snapshot[]
  /** Cotações resolvidas por ticker (fonte + status — RF19/RNF04). */
  cotacoes: Map<string, CotacaoResolvida>
  /** ISO do momento em que os dados foram montados (cache ou API). */
  carregadoEm: string
}

export interface CarregarDashboardOptions {
  /** Ignora o cache e busca todos os dados da API (refresh explícito). */
  forceRefresh?: boolean
  /** Não usa a rede (modo offline — RNF08): apenas cache local. */
  offline?: boolean
}

function temCacheCompleto(spreadsheetId: string): boolean {
  return (
    operacoesRepo.readCache(spreadsheetId) !== null &&
    proventosRepo.readCache(spreadsheetId) !== null &&
    consolidadoRepo.readCache(spreadsheetId) !== null &&
    historicoRepo.readCache(spreadsheetId) !== null
  )
}

/** Extrai `ticker → preço atual` (em centavos) da aba `Consolidado`. */
function precosDoConsolidado(linhas: readonly Consolidado[]): Map<string, number> {
  const precos = new Map<string, number>()
  for (const linha of linhas) {
    const ticker = linha.ticker.trim()
    if (ticker.length > 0 && linha.precoAtual > 0) precos.set(ticker, linha.precoAtual)
  }
  return precos
}

/** Cotações resolvidas a partir das linhas já materializadas do `Consolidado`. */
function cotacoesDoConsolidado(linhas: readonly Consolidado[]): Map<string, CotacaoResolvida> {
  const entradas: EntradaCotacao[] = linhas
    .filter((linha) => linha.ticker.trim().length > 0)
    .map((linha) => ({
      ticker: linha.ticker.trim(),
      categoria: linha.categoria,
      precoMedio: linha.precoMedio,
      precoMercado: linha.precoAtual > 0 ? linha.precoAtual : null,
      precoManual: null,
    }))
  return resolverCotacoes(entradas)
}

/** Monta as entradas de cotação combinando mercado (planilha/TD) e manual (RF). */
function montarEntradas(
  posicoes: readonly PosicaoConsolidada[],
  precoMercado: ReadonlyMap<string, number>,
  precoManual: ReadonlyMap<string, number>,
): EntradaCotacao[] {
  return posicoes.map((posicao) => ({
    ticker: posicao.ticker,
    categoria: posicao.categoria,
    precoMedio: posicao.precoMedio,
    precoMercado: precoMercado.get(posicao.ticker) ?? null,
    precoManual: precoManual.get(posicao.ticker) ?? null,
  }))
}

/** Tickers de Tesouro Direto com posição aberta. */
function tickersTesouro(posicoes: readonly PosicaoConsolidada[]): string[] {
  return posicoes
    .filter((posicao) => isTesouroDireto(posicao.categoria) && posicao.quantidadeAtual > 0)
    .map((posicao) => posicao.ticker)
}

interface MontarConsulta {
  operacoes: readonly Operacao[]
  linhasConsolidado: readonly Consolidado[]
  proventos: readonly Provento[]
  historico: readonly Snapshot[]
  /** Preços de mercado do Tesouro Direto (centavos), quando disponíveis. */
  cotacoesTesouro: ReadonlyMap<string, number>
}

function montarDashboard(consulta: MontarConsulta): DashboardData {
  const { operacoes, linhasConsolidado, proventos, historico, cotacoesTesouro } = consulta

  const base: Omit<DashboardData, 'consolidado' | 'resumo' | 'cotacoes'> = {
    operacoes: [...operacoes],
    proventos: [...proventos],
    historico: [...historico],
    carregadoEm: new Date().toISOString(),
  }

  if (operacoes.length === 0) {
    // Sem operações em cache: usa a aba `Consolidado` como fonte (quando houver).
    const consolidado = linhasConsolidado.filter((linha) => linha.ticker.trim().length > 0)
    return {
      ...base,
      consolidado,
      resumo: calcularResumo(consolidado),
      cotacoes: cotacoesDoConsolidado(consolidado),
    }
  }

  const posicoes = calcularPosicoes(operacoes)
  const precoMercado = precosDoConsolidado(linhasConsolidado)
  for (const [ticker, preco] of cotacoesTesouro) precoMercado.set(ticker, preco)
  const precoManual = precosManuaisDeOperacoes(operacoes)

  const cotacoes = resolverCotacoes(montarEntradas(posicoes, precoMercado, precoManual))
  const consolidado = aplicarPrecosAtuais(posicoes, precosDeCotacoes(cotacoes))

  return { ...base, consolidado, resumo: calcularResumo(consolidado), cotacoes }
}

/** Carrega consolidado, resumo, proventos, histórico e cotações (cache-first). */
export async function carregarDashboard(
  context: RepositoryContext,
  options: CarregarDashboardOptions = {},
): Promise<DashboardData> {
  const { spreadsheetId } = context
  const cacheCompleto = temCacheCompleto(spreadsheetId)

  if (!options.offline && (options.forceRefresh || !cacheCompleto)) {
    await prefetchAllSheets(context)
  }

  const operacoes = operacoesRepo.readCache(spreadsheetId) ?? []
  const linhasConsolidado = consolidadoRepo.readCache(spreadsheetId) ?? []
  const proventos = proventosRepo.readCache(spreadsheetId) ?? []
  const historico = historicoRepo.readCache(spreadsheetId) ?? []
  const cotacoesTesouro = await resolverCotacoesTesouro(operacoes, options.offline === true)

  return montarDashboard({ operacoes, linhasConsolidado, proventos, historico, cotacoesTesouro })
}

/**
 * Obtém as cotações do Tesouro (centavos) das posições abertas. No modo offline
 * usa apenas o cache local (RNF08); caso contrário, cache-first com fallback.
 */
async function resolverCotacoesTesouro(
  operacoes: readonly Operacao[],
  offline: boolean,
): Promise<Map<string, number>> {
  const tickers = tickersTesouro(calcularPosicoes(operacoes))
  const cotacoes = new Map<string, number>()
  if (tickers.length === 0) return cotacoes

  if (offline) {
    for (const ticker of tickers) {
      const cache = lerCotacaoCache(ticker)
      if (cache) cotacoes.set(ticker, cache.preco)
    }
    return cotacoes
  }

  const resolvidas = await buscarCotacoesTesouro(tickers)
  for (const [ticker, cotacao] of resolvidas) cotacoes.set(ticker, cotacao.preco)
  return cotacoes
}

/**
 * Lê o **último estado em cache** sem tocar a rede (RNF08 — modo offline).
 * Retorna `null` quando não há cache utilizável.
 */
export function lerDashboardDoCache(spreadsheetId: string): DashboardData | null {
  const operacoes = operacoesRepo.readCache(spreadsheetId)
  const linhasConsolidado = consolidadoRepo.readCache(spreadsheetId)
  if (operacoes === null && linhasConsolidado === null) return null

  const cotacoesTesouro = new Map<string, number>()
  for (const ticker of tickersTesouro(calcularPosicoes(operacoes ?? []))) {
    const cache = lerCotacaoCache(ticker)
    if (cache) cotacoesTesouro.set(ticker, cache.preco)
  }

  return montarDashboard({
    operacoes: operacoes ?? [],
    linhasConsolidado: linhasConsolidado ?? [],
    proventos: proventosRepo.readCache(spreadsheetId) ?? [],
    historico: historicoRepo.readCache(spreadsheetId) ?? [],
    cotacoesTesouro,
  })
}

/** Resumo patrimonial atual (RF07) a partir do estado em cache/API. */
export async function obterResumo(context: RepositoryContext): Promise<ResumoCarteira> {
  const { resumo } = await carregarDashboard(context)
  return resumo
}

/**
 * Captura um snapshot do estado atual da carteira (após salvar operações/
 * proventos — Seção 2). Reutiliza o carregamento cache-first e delega ao
 * serviço de histórico.
 */
export async function capturarSnapshot(context: RepositoryContext): Promise<Snapshot> {
  const { resumo } = await carregarDashboard(context)
  return registrarSnapshot(context, resumo)
}
