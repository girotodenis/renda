import { toISO } from '@/lib/dates'
import type { CellValue } from '@/lib/sheetCells'
import type { SheetName } from '@/lib/sheetsSchema'
import {
  consolidadoRepo,
  historicoRepo,
  metasRepo,
  operacoesRepo,
  prefetchAllSheets,
  proventosRepo,
} from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { getSheetsRequestCount, resetSheetsRequestCount } from '@/services/sheets'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/types/domain'
import type {
  Consolidado,
  MetaRebalanceamento,
  Operacao,
  Provento,
  Snapshot,
} from '@/types/domain'

/**
 * Diagnóstico da camada de dados (critério de conclusão da Etapa 2).
 *
 * Escreve uma linha em cada uma das 5 abas, faz **um** `batchGet` para atualizar
 * o cache e relê do cache **sem novas chamadas** à API. Conta as requisições de
 * rede para comprovar o comportamento.
 */

/** Ticker marcador usado nas linhas de teste. */
export const DIAGNOSTIC_TICKER = 'DIAG3'

/** Resultado por aba. */
export interface DiagnosticSheetResult {
  sheetName: SheetName
  /** ID gerado para a linha de teste (`null` em abas sem coluna `ID`). */
  appendId: string | null
  /** Linha de teste que foi escrita. */
  appended: Readonly<Record<string, CellValue>>
  /** Quantidade de linhas lidas do cache após a escrita (sem rede). */
  cachedRowCount: number
}

/** Relatório completo do diagnóstico. */
export interface DiagnosticReport {
  startedAt: string
  finishedAt: string
  ticker: string
  /** Total de requisições de rede à API do Sheets durante o diagnóstico. */
  totalRequests: number
  /** Requisições gastas nas 5 escritas (`values.append`). */
  writeRequests: number
  /** Requisições gastas no refresh agrupado (`values.batchGet`). */
  refreshRequests: number
  /** Requisições gastas ao reler do cache (deve ser `0`). */
  cacheReadRequests: number
  /** `true` quando reler do cache não gerou nenhuma chamada à API. */
  cacheReadUsedNoRequests: boolean
  sheets: DiagnosticSheetResult[]
}

function buildTestEntities(ticker: string, today: string) {
  const operacao: Operacao = {
    id: operacoesRepo.newId(),
    data: today,
    tipo: OperacaoTipo.Compra,
    categoria: CategoriaAtivo.Acao,
    ticker,
    quantidade: 1,
    precoUnitario: 1000,
    taxas: 0,
    indexador: null,
    percentualIndexador: null,
    vencimento: null,
    valorBrutoAtual: null,
  }

  const provento: Provento = {
    id: proventosRepo.newId(),
    dataCom: null,
    dataPagamento: today,
    categoria: CategoriaAtivo.Acao,
    ticker,
    tipo: ProventoTipo.Dividendo,
    valorTotal: 100,
  }

  const consolidado: Consolidado = {
    ticker,
    categoria: CategoriaAtivo.Acao,
    quantidadeAtual: 1,
    precoMedio: 1000,
    precoAtual: 1000,
    totalInvestido: 1000,
    valorAtual: 1000,
    lucroPrejuizo: 0,
    lucroPrejuizoPercent: 0,
    percentualCarteira: 0,
  }

  const meta: MetaRebalanceamento = {
    ticker,
    categoria: CategoriaAtivo.Acao,
    nota: 5,
    metaPercent: 0,
    valorAtual: 0,
    percentualAtual: 0,
    desvioPercent: 0,
    aporteSugerido: 0,
    quantidadeSugerida: 0,
    precoTeto: null,
  }

  const snapshot: Snapshot = {
    data: today,
    patrimonioTotal: 0,
    totalInvestido: 0,
    lucroAcumulado: 0,
  }

  return { operacao, provento, consolidado, meta, snapshot }
}

/** Executa o diagnóstico completo e devolve o relatório (lança em caso de falha). */
export async function runDataLayerDiagnostics(context: RepositoryContext): Promise<DiagnosticReport> {
  resetSheetsRequestCount()
  const startedAt = new Date().toISOString()
  const today = toISO(new Date())
  const ticker = DIAGNOSTIC_TICKER
  const { operacao, provento, consolidado, meta, snapshot } = buildTestEntities(ticker, today)

  // 1) Escrita: uma linha em cada aba (5 chamadas `values.append`).
  await operacoesRepo.append(context, operacao)
  await proventosRepo.append(context, provento)
  await consolidadoRepo.append(context, consolidado)
  await metasRepo.append(context, meta)
  await historicoRepo.append(context, snapshot)
  const writeRequests = getSheetsRequestCount()

  // 2) Refresh agrupado: uma única chamada `values.batchGet` para as 5 abas.
  await prefetchAllSheets(context)
  const refreshRequests = getSheetsRequestCount() - writeRequests

  // 3) Releitura do cache: não deve disparar nenhuma chamada à API.
  const requestsBeforeCacheRead = getSheetsRequestCount()

  const sheets: DiagnosticSheetResult[] = [
    {
      sheetName: 'Operacoes',
      appendId: operacao.id,
      appended: { id: operacao.id, ticker, data: today },
      cachedRowCount: operacoesRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Proventos',
      appendId: provento.id,
      appended: { id: provento.id, ticker, data: today },
      cachedRowCount: proventosRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Consolidado',
      appendId: null,
      appended: { ticker, data: today },
      cachedRowCount: consolidadoRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Metas_Rebalanceamento',
      appendId: null,
      appended: { ticker, data: today },
      cachedRowCount: metasRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Historico',
      appendId: null,
      appended: { data: today },
      cachedRowCount: historicoRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
  ]

  const cacheReadRequests = getSheetsRequestCount() - requestsBeforeCacheRead
  const finishedAt = new Date().toISOString()

  return {
    startedAt,
    finishedAt,
    ticker,
    totalRequests: getSheetsRequestCount(),
    writeRequests,
    refreshRequests,
    cacheReadRequests,
    cacheReadUsedNoRequests: cacheReadRequests === 0,
    sheets,
  }
}
