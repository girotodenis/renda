import { isTesouroDireto, usaGoogFinance } from '@/domain/categoria'
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
  ativosRepo,
  consolidadoRepo,
  historicoRepo,
  operacoesRepo,
  prefetchAllSheets,
  proventosRepo,
  valuationRepo,
} from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { carregarSetores, garantirAbasDoSchema, mapaDeSetores } from '@/application/setores'
import type { TickerCategoria } from '@/application/setores'
import { garantirColunasConsolidado, syncConsolidado } from '@/application/consolidado'
import { registrarSnapshot } from '@/application/historico'
import {
  integracoesCotacao,
  provedorCotacoesB3,
  provedorCotacoesTesouro,
} from '@/infrastructure/cotacoes/registro'
import type {
  CotacaoMercado,
  TituloTesouroCarteira,
  TokensProvedores,
} from '@/domain/provedoresCotacao'
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
 * - Tesouro Direto: preço de resgate via API de cotações → `Valor Bruto Atual` (marcação manual).
 * - Renda Fixa: `Valor Bruto Atual` (marcação manual editável).
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
  /**
   * Setor de atuação por ticker (aba `Ativos` + integrações). Tickers sem setor
   * ficam fora do mapa — o gráfico "Por setor" os omite.
   */
  setores: Map<string, string>
  /** Cotações resolvidas por ticker (fonte + status — RF19/RNF04). */
  cotacoes: Map<string, CotacaoResolvida>
  /**
   * Diagnóstico da consulta às APIs de cotação desta carga — usado pela UI
   * para avisar quando as integrações não devolveram preços. `null` quando não
   * há ativos elegíveis ou a carga não consultou as APIs (cache puro).
   */
  cotacoesApi: DiagnosticoCotacoesApi | null
  /** ISO do momento em que os dados foram montados (cache ou API). */
  carregadoEm: string
}

/** Resumo do que as integrações de cotação conseguiram (ou não) atualizar. */
export interface DiagnosticoCotacoesApi {
  /** Tickers elegíveis (Ação/FII/BDR/ETF/Tesouro Direto com posição aberta). */
  total: number
  /** Quantos desses têm cotação disponível nas APIs. */
  comCotacao: number
  /** Tickers sem cotação nesta consulta. */
  semCotacao: string[]
  /** Subconjunto de `semCotacao` com títulos do Tesouro Direto. */
  tesouroSemCotacao?: string[]
  /** `true` quando nenhuma integração que exige token está configurada. */
  semToken: boolean
  /** Nomes das integrações de cotação ativas, em ordem de prioridade (`['Brapi']`). */
  provedores: string[]
  /** Dicas das integrações para títulos do Tesouro sem cotação (ex.: plano pago). */
  dicasTesouro: string[]
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
    // não encontrados — abaixo de R$ 0,20 tratamos como erro e acionamos as APIs.
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
  precoApi: ReadonlyMap<string, number>,
  aberturaApi: ReadonlyMap<string, number> = new Map(),
): EntradaCotacao[] {
  return posicoes.map((posicao) => ({
    ticker: posicao.ticker,
    categoria: posicao.categoria,
    precoMedio: posicao.precoMedio,
    precoMercado: precoMercado.get(posicao.ticker) ?? null,
    precoAbertura: precoAberturaMercado.get(posicao.ticker) ?? aberturaApi.get(posicao.ticker) ?? null,
    precoManual: precoManual.get(posicao.ticker) ?? null,
    precoApi: precoApi.get(posicao.ticker) ?? null,
  }))
}

interface MontarConsulta {
  operacoes: readonly Operacao[]
  linhasConsolidado: readonly Consolidado[]
  proventos: readonly Provento[]
  historico: readonly Snapshot[]
  valuation: readonly Valuation[]
  /** Setores já resolvidos (aba `Ativos` + integrações), por ticker. */
  setores?: ReadonlyMap<string, string>
  /** Preços de mercado obtidos das APIs (centavos), fallback do `GOOGLEFINANCE`. */
  cotacoesApi: ReadonlyMap<string, number>
  /** Aberturas do dia obtidas das APIs (centavos), por ticker. */
  aberturasApi?: ReadonlyMap<string, number>
  /**
   * `true` numa atualização explícita: a cotação da API substitui o preço
   * gravado no `Consolidado` (que pode estar defasado após a remoção do
   * `GOOGLEFINANCE`).
   */
  forcarApi?: boolean
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
    setores = new Map<string, string>(),
    cotacoesApi,
    aberturasApi = new Map(),
    forcarApi = false,
    modoLocal = false,
  } = consulta

  const base: Omit<DashboardData, 'consolidado' | 'resumo' | 'cotacoes'> = {
    operacoes: [...operacoes],
    proventos: [...proventos],
    historico: [...historico],
    valuation: [...valuation],
    setores: new Map(setores),
    cotacoesApi: null,
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
  const precoApi = new Map<string, number>()
  if (modoLocal) {
    for (const posicao of posicoes) {
      const preco = precoConsolidado.get(posicao.ticker)
      if (preco !== undefined && usaGoogFinance(posicao.categoria)) precoApi.set(posicao.ticker, preco)
    }
  }
  for (const [ticker, preco] of cotacoesApi) precoApi.set(ticker, preco)

  // Atualização explícita: a cotação recém-buscada tem prioridade sobre o preço
  // gravado no `Consolidado` (que pode vir de uma importação antiga).
  if (forcarApi) {
    for (const ticker of cotacoesApi.keys()) precoMercado.delete(ticker)
  }

  const cotacoes = resolverCotacoes(
    montarEntradas(posicoes, precoMercado, precoAbertura, precoManual, precoApi, aberturasApi),
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

  // Planilhas abertas antes de uma aba nova entrar no schema: cria as ausentes
  // antes de ler cabeçalhos — sem isso, o `batchGet` de `ensureSheetHeaders`
  // falharia por intervalo inexistente.
  if (!options.offline) await garantirAbasDoSchema(context)

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
  // Cotações e setores são consultas independentes: vão juntas para não somar
  // latências (o setor só usa a rede para tickers ainda desconhecidos).
  const [api, setores] = await Promise.all([
    resolverCotacoesApi(
      operacoes,
      linhasConsolidado,
      options.offline === true,
      config.tokens,
      modoLocal || forceRefresh,
      forceRefresh,
    ),
    carregarSetores(context, posicoesParaSetor(operacoes, linhasConsolidado), {
      tokens: config.tokens,
      offline: options.offline === true,
    }),
  ])

  const dados = montarDashboard({
    operacoes,
    linhasConsolidado,
    proventos,
    historico,
    valuation,
    setores,
    cotacoesApi: api.precos,
    aberturasApi: api.aberturas,
    forcarApi: forceRefresh,
    modoLocal,
  })

  return { ...dados, cotacoesApi: api.diagnostico }
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

/**
 * Posições abertas (ticker + categoria) usadas para resolver o setor de
 * atuação. Usa as operações quando existem; senão, a própria aba `Consolidado`.
 */
function posicoesParaSetor(
  operacoes: readonly Operacao[],
  linhasConsolidado: readonly Consolidado[],
): TickerCategoria[] {
  const posicoes = calcularPosicoes(operacoes).filter(
    (posicao) => posicao.quantidadeAtual > 0,
  )
  const origem: readonly TickerCategoria[] =
    posicoes.length > 0
      ? posicoes
      : linhasConsolidado
          .filter((linha) => linha.quantidadeAtual > 0 && linha.ticker.trim().length > 0)
          .map((linha) => ({ ticker: linha.ticker, categoria: linha.categoria }))
  return origem.map(({ ticker, categoria }) => ({ ticker, categoria }))
}

/** Posições B3 abertas sem preço GoogleFinance (ou todas no modo local). */
function tickersB3(
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

/**
 * Títulos do Tesouro Direto com posição aberta, com o vencimento registrado
 * nas operações (refina o casamento quando o ticker traz só o ano).
 */
function tickersTesouro(
  operacoes: readonly Operacao[],
  posicoes: readonly PosicaoConsolidada[],
): TituloTesouroCarteira[] {
  const vencimentos = new Map<string, string>()
  for (const operacao of operacoes) {
    const ticker = operacao.ticker.trim()
    if (isTesouroDireto(operacao.categoria) && operacao.vencimento && !vencimentos.has(ticker)) {
      vencimentos.set(ticker, operacao.vencimento)
    }
  }
  return posicoes
    .filter((posicao) => isTesouroDireto(posicao.categoria) && posicao.quantidadeAtual > 0)
    .map((posicao) => ({
      ticker: posicao.ticker,
      vencimento: vencimentos.get(posicao.ticker) ?? null,
    }))
}

/** Acumula preços (+ aberturas) das cotações das APIs nos mapas informados. */
function acumularCotacoes(
  cotacoes: ReadonlyMap<string, CotacaoMercado>,
  precos: Map<string, number>,
  aberturas: Map<string, number>,
): void {
  for (const [ticker, cotacao] of cotacoes) {
    precos.set(ticker, cotacao.preco)
    if (cotacao.precoAbertura !== null) aberturas.set(ticker, cotacao.precoAbertura)
  }
}

/** Cotações das APIs do cache local (preços + aberturas) para os tickers elegíveis. */
function cotacoesApiDoCache(
  operacoes: readonly Operacao[],
  linhasConsolidado: readonly Consolidado[],
  atualizarMesmoComPreco: boolean,
): { precos: Map<string, number>; aberturas: Map<string, number> } {
  const posicoes = calcularPosicoes(operacoes)
  const tickers = tickersB3(
    posicoes,
    precosDoConsolidado(linhasConsolidado, atualizarMesmoComPreco),
    atualizarMesmoComPreco,
  )
  const precos = new Map<string, number>()
  const aberturas = new Map<string, number>()
  for (const ticker of tickers) {
    const cache = provedorCotacoesB3.lerCache(ticker)
    if (!cache) continue
    precos.set(ticker, cache.preco)
    if (cache.precoAbertura !== null) aberturas.set(ticker, cache.precoAbertura)
  }
  acumularCotacoes(provedorCotacoesTesouro.lerCache(tickersTesouro(operacoes, posicoes)), precos, aberturas)
  return { precos, aberturas }
}

/**
 * Obtém cotações das APIs (centavos, cadeia de integrações) para posições de Ação/FII/BDR/ETF e
 * Tesouro Direto.
 *
 * B3: no modo local e na atualização explícita (`forceRefresh`), consulta
 * **todas** as posições abertas — o `Consolidado` pode conter preços estáticos
 * (modo local e banco JSON, sem `GOOGLEFINANCE`). Fora isso, apenas as posições
 * sem preço na planilha. Tesouro Direto: sempre todas as posições abertas
 * (cache-first). No modo offline usa somente o cache local (RNF08).
 */
async function resolverCotacoesApi(
  operacoes: readonly Operacao[],
  linhasConsolidado: readonly Consolidado[],
  offline: boolean,
  tokens: TokensProvedores,
  atualizarMesmoComPreco: boolean,
  forceRefresh: boolean,
): Promise<ResolucaoApi> {
  const posicoes = calcularPosicoes(operacoes)
  const tickers = tickersB3(
    posicoes,
    precosDoConsolidado(linhasConsolidado, atualizarMesmoComPreco),
    atualizarMesmoComPreco,
  )
  const titulos = tickersTesouro(operacoes, posicoes)
  const total = tickers.length + titulos.length
  if (total === 0) {
    return { precos: new Map(), aberturas: new Map(), diagnostico: null }
  }

  if (offline) {
    const cache = cotacoesApiDoCache(operacoes, linhasConsolidado, atualizarMesmoComPreco)
    const todos = [...tickers, ...titulos.map(({ ticker }) => ticker)]
    return {
      ...cache,
      diagnostico: {
        total,
        comCotacao: cache.precos.size,
        semCotacao: todos.filter((ticker) => !cache.precos.has(ticker)),
        tesouroSemCotacao: titulos
          .map(({ ticker }) => ticker)
          .filter((ticker) => !cache.precos.has(ticker)),
        ...metadadosIntegracoes(tokens),
        forcado: false,
      },
    }
  }

  const semB3 = { cotacoes: new Map<string, CotacaoMercado>(), semCotacao: [], semToken: false }
  const opcoes = { tokens, forceRefresh }
  const [b3, tesouro] = await Promise.all([
    tickers.length > 0 ? provedorCotacoesB3.atualizar(tickers, opcoes) : semB3,
    provedorCotacoesTesouro.atualizar(titulos, opcoes),
  ])
  const precos = new Map<string, number>()
  const aberturas = new Map<string, number>()
  acumularCotacoes(b3.cotacoes, precos, aberturas)
  acumularCotacoes(tesouro.cotacoes, precos, aberturas)

  return {
    precos,
    aberturas,
    diagnostico: {
      total,
      comCotacao: precos.size,
      semCotacao: [...b3.semCotacao, ...tesouro.semCotacao],
      tesouroSemCotacao: tesouro.semCotacao,
      ...metadadosIntegracoes(tokens),
      semToken: b3.semToken || tesouro.semToken,
      forcado: forceRefresh,
    },
  }
}

/** Nomes, dicas e estado dos tokens das integrações (para o diagnóstico). */
function metadadosIntegracoes(
  tokens: TokensProvedores,
): Pick<DiagnosticoCotacoesApi, 'provedores' | 'dicasTesouro' | 'semToken'> {
  const exigemToken = integracoesCotacao.filter((integracao) => integracao.exigeToken)
  return {
    provedores: integracoesCotacao.map((integracao) => integracao.nome),
    dicasTesouro: integracoesCotacao.flatMap((integracao) =>
      integracao.dicaTesouroSemCotacao ? [integracao.dicaTesouroSemCotacao] : [],
    ),
    semToken:
      exigemToken.length > 0 &&
      exigemToken.every((integracao) => (tokens[integracao.id] ?? '').trim().length === 0),
  }
}

/** Cotações das APIs resolvidas (+ aberturas) e o diagnóstico da consulta. */
interface ResolucaoApi {
  precos: Map<string, number>
  aberturas: Map<string, number>
  diagnostico: DiagnosticoCotacoesApi | null
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
  const { precos, aberturas } = cotacoesApiDoCache(
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
    setores: mapaDeSetores(ativosRepo.readCache(spreadsheetId) ?? []),
    cotacoesApi: precos,
    aberturasApi: aberturas,
    modoLocal,
  })

  return { ...dados, cotacoesApi: null }
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
