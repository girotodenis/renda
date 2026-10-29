import { usaGoogFinance } from '@/domain/categoria'
import { aplicarPrecosAtuais, calcularPosicoes, calcularResumo } from '@/domain/consolidado'
import type { PosicaoConsolidada, ResumoCarteira } from '@/domain/consolidado'
import {
  precosDeCotacoes,
  precosManuaisDeOperacoes,
  precoMercadoValido,
  resolverCotacoes,
} from '@/domain/cotacoes'
import type { CotacaoResolvida, EntradaCotacao } from '@/domain/cotacoes'
import {
  consolidadoRepo,
  historicoRepo,
  operacoesRepo,
  prefetchAllSheets,
  proventosRepo,
  valuationRepo,
} from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { garantirColunasConsolidado, syncConsolidado } from '@/application/consolidado'
import { registrarSnapshot } from '@/application/historico'
import { atualizarCotacoesBrapi, lerCotacaoCache as lerCotacaoCacheBrapi } from '@/infrastructure/brapi'
import { carregarConfiguracoes } from '@/application/configuracoes'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import type { Consolidado, Operacao, Provento, Snapshot, Valuation } from '@/domain/entities'

/**
 * Orquestração de dados do dashboard (RF07–RF11, RF19, RNF02/RNF04/RNF06/RNF08).
 *
 * Estratégia **cache-first**: a leitura é sempre do cache local; a rede só é
 * acionada quando o cache está frio (uma única `batchGet`) ou em refresh
 * explícito. O consolidado é recalculado no app (`lib/consolidado`) com as
 * cotações resolvidas por categoria:
 * - Ação/FII/BDR: valor computado do `GOOGLEFINANCE` lido da aba `Consolidado`.
 * - Tesouro Direto / Renda Fixa: `Valor Bruto Atual` (marcação manual editável).
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
  /** Análises de valuation por ticker (aba `Valuation` — alerta de oportunidade). */
  valuation: Valuation[]
  /** Cotações resolvidas por ticker (fonte + status — RF19/RNF04). */
  cotacoes: Map<string, CotacaoResolvida>
  /**
   * Diagnóstico da consulta de cotações B3 (Brapi) desta carga — usado pela UI
   * para avisar quando a integração não devolveu preços. `null` quando não há
   * ativos elegíveis ou a carga não consultou a Brapi (cache puro).
   */
  cotacoesBrapi: DiagnosticoCotacoesBrapi | null
  /** ISO do momento em que os dados foram montados (cache ou API). */
  carregadoEm: string
}

/** Resumo do que a integração Brapi conseguiu (ou não) atualizar. */
export interface DiagnosticoCotacoesBrapi {
  /** Tickers elegíveis (Ação/FII/BDR/ETF com posição aberta). */
  total: number
  /** Quantos desses têm cotação Brapi disponível. */
  comCotacao: number
  /** Tickers sem cotação nesta consulta. */
  semCotacao: string[]
  /** `true` quando não há token da Brapi configurado. */
  semToken: boolean
  /** `true` quando a consulta ignorou o cache (atualização manual). */
  forcado: boolean
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
function precosDoConsolidado(
  linhas: readonly Consolidado[],
  modoLocal = false,
): Map<string, number> {
  const precos = new Map<string, number>()
  for (const linha of linhas) {
    const ticker = linha.ticker.trim()
    if (ticker.length === 0) continue
    // Ignora cotações inválidas: o GOOGLEFINANCE devolve ~R$ 0,11 para tickers
    // não encontrados — abaixo de R$ 0,20 tratamos como erro e acionamos a Brapi.
    const precoValido = modoLocal
      ? Number.isFinite(linha.precoAtual) && linha.precoAtual > 0
      : precoMercadoValido(linha.precoAtual, linha.categoria)
    if (precoValido) {
      precos.set(ticker, linha.precoAtual)
    }
  }
  return precos
}

/**
 * Extrai `ticker → preço de abertura do dia` (em centavos) da aba
 * `Consolidado`. Linhas sem abertura (planilhas antigas, Renda Fixa/Tesouro)
 * ficam de fora; o resolvedor devolve variação `null` para elas.
 */
function aberturasDoConsolidado(linhas: readonly Consolidado[]): Map<string, number> {
  const aberturas = new Map<string, number>()
  for (const linha of linhas) {
    const ticker = linha.ticker.trim()
    if (ticker.length === 0) continue
    const abertura = linha.precoAbertura ?? null
    if (precoMercadoValido(abertura, linha.categoria)) aberturas.set(ticker, abertura)
  }
  return aberturas
}

/** Cotações resolvidas a partir das linhas já materializadas do `Consolidado`. */
function cotacoesDoConsolidado(
  linhas: readonly Consolidado[],
  modoLocal = false,
): Map<string, CotacaoResolvida> {
  const entradas: EntradaCotacao[] = linhas
    .filter((linha) => linha.ticker.trim().length > 0)
    .map((linha) => ({
      ticker: linha.ticker.trim(),
      categoria: linha.categoria,
      precoMedio: linha.precoMedio,
      precoMercado: precoMercadoValido(linha.precoAtual, linha.categoria)
        ? linha.precoAtual
        : null,
      precoAbertura: modoLocal ? null : (linha.precoAbertura ?? null),
      precoManual: null,
    }))
  return resolverCotacoes(entradas)
}

/** Monta as entradas de cotação combinando mercado (planilha/TD) e manual (RF). */
function montarEntradas(
  posicoes: readonly PosicaoConsolidada[],
  precoMercado: ReadonlyMap<string, number>,
  precoAberturaMercado: ReadonlyMap<string, number>,
  precoManual: ReadonlyMap<string, number>,
  precoBrapi: ReadonlyMap<string, number>,
  aberturaBrapi: ReadonlyMap<string, number> = new Map(),
): EntradaCotacao[] {
  return posicoes.map((posicao) => ({
    ticker: posicao.ticker,
    categoria: posicao.categoria,
    precoMedio: posicao.precoMedio,
    precoMercado: precoMercado.get(posicao.ticker) ?? null,
    precoAbertura: precoAberturaMercado.get(posicao.ticker) ?? aberturaBrapi.get(posicao.ticker) ?? null,
    precoManual: precoManual.get(posicao.ticker) ?? null,
    precoBrapi: precoBrapi.get(posicao.ticker) ?? null,
  }))
}

interface MontarConsulta {
  operacoes: readonly Operacao[]
  linhasConsolidado: readonly Consolidado[]
  proventos: readonly Provento[]
  historico: readonly Snapshot[]
  valuation: readonly Valuation[]
  /** Preços de mercado B3 via Brapi (centavos), fallback do `GOOGLEFINANCE`. */
  cotacoesBrapi: ReadonlyMap<string, number>
  /** Aberturas do dia obtidas da Brapi (centavos), por ticker. */
  aberturasBrapi?: ReadonlyMap<string, number>
  /**
   * `true` numa atualização explícita: a cotação da Brapi substitui o preço
   * gravado no `Consolidado` (que pode estar defasado após a remoção do
   * `GOOGLEFINANCE`).
   */
  forcarBrapi?: boolean
  /** No modo local, `Consolidado` contém valores estáticos, não cotações GoogleFinance. */
  modoLocal?: boolean
}

function montarDashboard(consulta: MontarConsulta): DashboardData {
  const {
    operacoes,
    linhasConsolidado,
    proventos,
    historico,
    valuation,
    cotacoesBrapi,
    aberturasBrapi = new Map(),
    forcarBrapi = false,
    modoLocal = false,
  } = consulta

  const base: Omit<DashboardData, 'consolidado' | 'resumo' | 'cotacoes'> = {
    operacoes: [...operacoes],
    proventos: [...proventos],
    historico: [...historico],
    valuation: [...valuation],
    cotacoesBrapi: null,
    carregadoEm: new Date().toISOString(),
  }

  if (operacoes.length === 0) {
    // Sem operações em cache: usa a aba `Consolidado` como fonte (quando houver).
    const consolidado = linhasConsolidado.filter((linha) => linha.ticker.trim().length > 0)
    return {
      ...base,
      consolidado,
      resumo: calcularResumo(consolidado),
      cotacoes: cotacoesDoConsolidado(consolidado, modoLocal),
    }
  }

  const posicoes = calcularPosicoes(operacoes)
  const precoConsolidado = precosDoConsolidado(linhasConsolidado, modoLocal)
  const precoMercado = modoLocal ? new Map<string, number>() : precoConsolidado
  const precoAbertura = modoLocal ? new Map<string, number>() : aberturasDoConsolidado(linhasConsolidado)
  const precoManual = precosManuaisDeOperacoes(operacoes)
  const precoBrapi = new Map<string, number>()
  if (modoLocal) {
    for (const [ticker, preco] of precoConsolidado) precoBrapi.set(ticker, preco)
  }
  for (const [ticker, preco] of cotacoesBrapi) precoBrapi.set(ticker, preco)

  // Atualização explícita: a cotação recém-buscada tem prioridade sobre o preço
  // gravado no `Consolidado` (que pode vir de uma importação antiga).
  if (forcarBrapi) {
    for (const ticker of cotacoesBrapi.keys()) precoMercado.delete(ticker)
  }

  const cotacoes = resolverCotacoes(
    montarEntradas(posicoes, precoMercado, precoAbertura, precoManual, precoBrapi, aberturasBrapi),
  )
  const consolidado = aplicarPrecosAtuais(posicoes, precosDeCotacoes(cotacoes))

  return { ...base, consolidado, resumo: calcularResumo(consolidado), cotacoes }
}

/**
 * Migração idempotente da planilha (uma vez por planilha/sessão): garante as
 * colunas `Preço Abertura` e `Variação Dia (%)` em planilhas criadas antes
 * desta versão e recalcula o `Consolidado` para preencher as fórmulas.
 *
 * Best-effort: falhas de rede/quota não impedem a leitura do dashboard — a
 * migração é tentada novamente no próximo carregamento.
 */
async function migrarColunasConsolidado(context: RepositoryContext): Promise<void> {
  if (isModoLocal()) return
  try {
    const atualizado = await garantirColunasConsolidado(context)
    if (!atualizado) return
    await syncConsolidado(context)
    await prefetchAllSheets(context)
  } catch {
    // A próxima abertura tenta de novo (garantirColunasConsolidado não marca
    // a planilha como verificada quando a chamada falha).
  }
}

/** Carrega consolidado, resumo, proventos, histórico e cotações (cache-first). */
export async function carregarDashboard(
  context: RepositoryContext,
  options: CarregarDashboardOptions = {},
): Promise<DashboardData> {
  const { spreadsheetId } = context

  if (!options.offline) await migrarColunasConsolidado(context)

  const cacheCompleto = temCacheCompleto(spreadsheetId)

  if (!options.offline && (options.forceRefresh || !cacheCompleto)) {
    await prefetchAllSheets(context)
  }

  const operacoes = operacoesRepo.readCache(spreadsheetId) ?? []
  const linhasConsolidado = consolidadoRepo.readCache(spreadsheetId) ?? []
  const proventos = proventosRepo.readCache(spreadsheetId) ?? []
  const historico = historicoRepo.readCache(spreadsheetId) ?? []
  const valuation = await carregarValuations(context, options.offline === true)
  const config = await carregarConfiguracoes(context, options.offline === true)
  const modoLocal = isModoLocal()
  const forceRefresh = options.forceRefresh === true
  const brapi = await resolverCotacoesBrapi(
    operacoes,
    linhasConsolidado,
    options.offline === true,
    config.brapiToken,
    modoLocal || forceRefresh,
    forceRefresh,
  )

  const dados = montarDashboard({
    operacoes,
    linhasConsolidado,
    proventos,
    historico,
    valuation,
    cotacoesBrapi: brapi.precos,
    aberturasBrapi: brapi.aberturas,
    forcarBrapi: forceRefresh,
    modoLocal,
  })

  return { ...dados, cotacoesBrapi: brapi.diagnostico }
}

/**
 * Lê as análises de valuation (aba `Valuation`) de forma **cache-first** e
 * tolerante: como a aba é mais recente que as demais, planilhas antigas podem
 * ainda não tê-la — nesse caso a leitura falha silenciosamente e retorna `[]`.
 */
async function carregarValuations(
  context: RepositoryContext,
  offline: boolean,
): Promise<Valuation[]> {
  if (offline) return valuationRepo.readCache(context.spreadsheetId) ?? []
  try {
    return await valuationRepo.list(context)
  } catch {
    return valuationRepo.readCache(context.spreadsheetId) ?? []
  }
}

/** Posições B3 abertas sem preço GoogleFinance (ou todas no modo local). */
function tickersBrapi(
  posicoes: readonly PosicaoConsolidada[],
  precoPlanilha: ReadonlyMap<string, number>,
  atualizarMesmoComPreco: boolean,
): string[] {
  return posicoes
    .filter(
      (posicao) =>
        usaGoogFinance(posicao.categoria) &&
        posicao.quantidadeAtual > 0 &&
        (atualizarMesmoComPreco || !precoPlanilha.has(posicao.ticker)),
    )
    .map((posicao) => posicao.ticker)
}

/** Cotações Brapi do cache local (preços + aberturas) para os tickers elegíveis. */
function cotacoesBrapiDoCache(
  operacoes: readonly Operacao[],
  linhasConsolidado: readonly Consolidado[],
  atualizarMesmoComPreco: boolean,
): { precos: Map<string, number>; aberturas: Map<string, number> } {
  const tickers = tickersBrapi(
    calcularPosicoes(operacoes),
    precosDoConsolidado(linhasConsolidado, atualizarMesmoComPreco),
    atualizarMesmoComPreco,
  )
  const precos = new Map<string, number>()
  const aberturas = new Map<string, number>()
  for (const ticker of tickers) {
    const cache = lerCotacaoCacheBrapi(ticker)
    if (!cache) continue
    precos.set(ticker, cache.preco)
    if (cache.precoAbertura !== null) aberturas.set(ticker, cache.precoAbertura)
  }
  return { precos, aberturas }
}

/**
 * Obtém cotações B3 via Brapi (centavos) para posições de Ação/FII/BDR/ETF.
 *
 * No modo local e na atualização explícita (`forceRefresh`), consulta **todas**
 * as posições abertas — o `Consolidado` pode conter preços estáticos (modo local
 * e banco JSON, sem `GOOGLEFINANCE`). Fora isso, apenas as posições sem preço
 * na planilha. No modo offline usa somente o cache local (RNF08).
 */
async function resolverCotacoesBrapi(
  operacoes: readonly Operacao[],
  linhasConsolidado: readonly Consolidado[],
  offline: boolean,
  token: string,
  atualizarMesmoComPreco: boolean,
  forceRefresh: boolean,
): Promise<ResolucaoBrapi> {
  const tickers = tickersBrapi(
    calcularPosicoes(operacoes),
    precosDoConsolidado(linhasConsolidado, atualizarMesmoComPreco),
    atualizarMesmoComPreco,
  )
  if (tickers.length === 0) {
    return { precos: new Map(), aberturas: new Map(), diagnostico: null }
  }

  if (offline) {
    const cache = cotacoesBrapiDoCache(operacoes, linhasConsolidado, atualizarMesmoComPreco)
    return {
      ...cache,
      diagnostico: {
        total: tickers.length,
        comCotacao: cache.precos.size,
        semCotacao: tickers.filter((ticker) => !cache.precos.has(ticker)),
        semToken: token.trim().length === 0,
        forcado: false,
      },
    }
  }

  const resultado = await atualizarCotacoesBrapi(tickers, { token, forceRefresh })
  const precos = new Map<string, number>()
  const aberturas = new Map<string, number>()
  for (const [ticker, cotacao] of resultado.cotacoes) {
    precos.set(ticker, cotacao.preco)
    if (cotacao.precoAbertura !== null) aberturas.set(ticker, cotacao.precoAbertura)
  }

  return {
    precos,
    aberturas,
    diagnostico: {
      total: tickers.length,
      comCotacao: precos.size,
      semCotacao: resultado.semCotacao,
      semToken: resultado.semToken,
      forcado: forceRefresh,
    },
  }
}

/** Cotações Brapi resolvidas (+ aberturas) e o diagnóstico da consulta. */
interface ResolucaoBrapi {
  precos: Map<string, number>
  aberturas: Map<string, number>
  diagnostico: DiagnosticoCotacoesBrapi | null
}

/**
 * Lê o **último estado em cache** sem tocar a rede (RNF08 — modo offline).
 * Retorna `null` quando não há cache utilizável.
 */
export function lerDashboardDoCache(spreadsheetId: string): DashboardData | null {
  const operacoes = operacoesRepo.readCache(spreadsheetId)
  const linhasConsolidado = consolidadoRepo.readCache(spreadsheetId)
  if (operacoes === null && linhasConsolidado === null) return null

  const modoLocal = isModoLocal()
  const { precos, aberturas } = cotacoesBrapiDoCache(
    operacoes ?? [],
    linhasConsolidado ?? [],
    modoLocal,
  )

  const dados = montarDashboard({
    operacoes: operacoes ?? [],
    linhasConsolidado: linhasConsolidado ?? [],
    proventos: proventosRepo.readCache(spreadsheetId) ?? [],
    historico: historicoRepo.readCache(spreadsheetId) ?? [],
    valuation: valuationRepo.readCache(spreadsheetId) ?? [],
    cotacoesBrapi: precos,
    aberturasBrapi: aberturas,
    modoLocal,
  })

  return { ...dados, cotacoesBrapi: null }
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
