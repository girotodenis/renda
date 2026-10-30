import { aplicarPrecosAtuais, calcularPosicoes } from '@/domain/consolidado'
import type { PrecosAtuais } from '@/domain/consolidado'
import { precosManuaisDeOperacoes, precosPersistidosDeOperacoes } from '@/domain/cotacoes'
import { buildConsolidadoRows, buildConsolidadoRowsEstaticas, formulaSeparatorForLocale } from '@/infrastructure/sheets/sheetFormulas'
import { SHEET_HEADERS } from '@/domain/sheetsSchema'
import { consolidadoRepo, operacoesRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import { clearValues, columnLetter, ensureSheetHeaders, getSpreadsheetLocale, updateValues } from '@/infrastructure/sheets/gatewayRouter'
import type { ValueInputOption } from '@/infrastructure/sheets/gatewayRouter'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import type { Consolidado, Operacao } from '@/domain/entities'

/**
 * Materialização da aba `Consolidado` (Seção 5.1) via repositório.
 *
 * As operações são consolidadas no app (módulo puro `lib/consolidado`); a aba é
 * reescrita com os valores de custo (quantidade e preço médio) e **fórmulas**
 * nas colunas dependentes de cotação. `Preço Atual` usa `GOOGLEFINANCE` para
 * Ação/FII/BDR; as demais categorias (Tesouro Direto / Renda Fixa) usam o preço
 * informado (ou o preço médio como fallback).
 *
 * A escrita usa `USER_ENTERED` para que as fórmulas sejam interpretadas e o
 * separador de argumentos respeita o locale da planilha.
 */

const CONSOLIDADO_SHEET = 'Consolidado' as const

/**
 * Planilhas cujo cabeçalho já foi verificado nesta sessão. Evita um `batchGet`
 * de cabeçalhos a cada sincronização; se a verificação falhar (rede/quota), a
 * planilha é removida do conjunto para tentar de novo no próximo ciclo.
 */
const planilhasComCabecalhosVerificados = new Set<string>()

/**
 * Garante as colunas novas do `Consolidado` (`Preço Abertura` e
 * `Variação Dia (%)`) em planilhas criadas antes desta versão.
 *
 * Retorna `true` quando o cabeçalho foi estendido — nesse caso a aba precisa
 * ser reescrita para que as fórmulas das novas colunas sejam preenchidas.
 * Best-effort: falhas de rede/quota não bloqueiam a sincronização.
 */
export async function garantirColunasConsolidado(context: RepositoryContext): Promise<boolean> {
  if (isModoLocal() || planilhasComCabecalhosVerificados.has(context.spreadsheetId)) return false
  planilhasComCabecalhosVerificados.add(context.spreadsheetId)
  try {
    return (await ensureSheetHeaders(context.accessToken, context.spreadsheetId)) > 0
  } catch {
    planilhasComCabecalhosVerificados.delete(context.spreadsheetId)
    return false
  }
}

export interface SyncConsolidadoOptions {
  /** Ignora o cache e relê as operações da API (refresh explícito). */
  forceRefreshOperacoes?: boolean
  /** Cotações atuais em centavos (ex.: preço manual da carteira). */
  precosAtuais?: PrecosAtuais
}

function consolidadoDataRange(): string {
  const lastColumn = columnLetter(SHEET_HEADERS[CONSOLIDADO_SHEET].length)
  return `'${CONSOLIDADO_SHEET}'!A2:${lastColumn}`
}

/**
 * Reescreve a aba `Consolidado` a partir das operações informadas e devolve o
 * consolidado calculado no app (útil para feedback imediato na UI).
 *
 * Preserva a estrutura de fórmulas: a região gravável é reescrita por completo
 * com o template de fórmulas (idempotente), nunca com valores estáticos nas
 * colunas calculadas.
 */
export async function writeConsolidado(
  context: RepositoryContext,
  operacoes: readonly Operacao[],
  precosAtuais: PrecosAtuais = new Map(),
): Promise<Consolidado[]> {
  // Planilhas antigas não têm as colunas de abertura/variação: garante o
  // cabeçalho antes de reescrever a região de dados (idempotente).
  await garantirColunasConsolidado(context)

  const posicoes = calcularPosicoes(operacoes)
  const consolidado = aplicarPrecosAtuais(posicoes, precosAtuais)

  // Modo Google: a planilha é a superfície de cálculo (`GOOGLEFINANCE`), então as
  // colunas dependentes de cotação vão como fórmula.
  // Modo local: não existe superfície de cálculo no arquivo — a aba recebe os
  // valores já calculados pelo app, prontos para o `.ods` exportado.
  let rows: CellValue[][]
  let inputOption: ValueInputOption

  if (isModoLocal()) {
    rows = buildConsolidadoRowsEstaticas(consolidado)
    inputOption = 'RAW'
  } else {
    const locale = await getSpreadsheetLocale(context.accessToken, context.spreadsheetId)
    const separator = formulaSeparatorForLocale(locale)
    rows = buildConsolidadoRows({ posicoes, precosAtuais, separator })
    inputOption = 'USER_ENTERED'
  }

  const range = consolidadoDataRange()
  await clearValues(context.accessToken, context.spreadsheetId, range)
  if (rows.length > 0) {
    await updateValues(
      context.accessToken,
      context.spreadsheetId,
      `${range}${rows.length + 1}`,
      rows,
      inputOption,
    )
  }

  consolidadoRepo.invalidateCache(context.spreadsheetId)
  return consolidado
}

/** Relê as operações (cache primeiro) e sincroniza a aba `Consolidado`. */
export async function syncConsolidado(
  context: RepositoryContext,
  options: SyncConsolidadoOptions = {},
): Promise<Consolidado[]> {
  const operacoes = await operacoesRepo.list(context, {
    forceRefresh: options.forceRefreshOperacoes,
  })
  const precosAtuais = options.precosAtuais ?? (await precosDaCarteira(operacoes))
  return writeConsolidado(context, operacoes, precosAtuais)
}

/**
 * Preços para as classes sem `GOOGLEFINANCE` (RF19): Renda Fixa e Tesouro Direto
 * usam a marcação manual (`Valor Bruto Atual`) e os ativos B3 podem ter preço
 * persistido via API de cotações (fallback do `GOOGLEFINANCE`). Sem preço, o
 * `writeConsolidado` cai no preço médio como fallback (RNF04).
 */
async function precosDaCarteira(
  operacoes: readonly Operacao[],
): Promise<Map<string, number>> {
  const precos = new Map<string, number>(precosManuaisDeOperacoes(operacoes))

  // B3 (Ação/FII/BDR/ETF): preço persistido via API de cotações (fallback do GOOGLEFINANCE).
  for (const [ticker, preco] of precosPersistidosDeOperacoes(operacoes)) precos.set(ticker, preco)

  return precos
}
