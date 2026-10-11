import { aplicarPrecosAtuais, calcularPosicoes } from '@/domain/consolidado'
import type { PrecosAtuais } from '@/domain/consolidado'
import { precosManuaisDeOperacoes, precosPersistidosDeOperacoes } from '@/domain/cotacoes'
import { buildConsolidadoRows, formulaSeparatorForLocale } from '@/infrastructure/sheets/sheetFormulas'
import { SHEET_HEADERS } from '@/domain/sheetsSchema'
import { consolidadoRepo, operacoesRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { clearValues, columnLetter, getSpreadsheetLocale, updateValues } from '@/infrastructure/sheets/gateway'
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
  const posicoes = calcularPosicoes(operacoes)
  const consolidado = aplicarPrecosAtuais(posicoes, precosAtuais)

  const locale = await getSpreadsheetLocale(context.accessToken, context.spreadsheetId)
  const separator = formulaSeparatorForLocale(locale)
  const rows = buildConsolidadoRows({ posicoes, precosAtuais, separator })

  const range = consolidadoDataRange()
  await clearValues(context.accessToken, context.spreadsheetId, range)
  if (rows.length > 0) {
    await updateValues(
      context.accessToken,
      context.spreadsheetId,
      `${range}${rows.length + 1}`,
      rows,
      'USER_ENTERED',
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
 * persistido via Brapi (fallback do `GOOGLEFINANCE`). Sem preço, o
 * `writeConsolidado` cai no preço médio como fallback (RNF04).
 */
async function precosDaCarteira(
  operacoes: readonly Operacao[],
): Promise<Map<string, number>> {
  const precos = new Map<string, number>(precosManuaisDeOperacoes(operacoes))

  // B3 (Ação/FII/BDR/ETF): preço persistido via Brapi (fallback do GOOGLEFINANCE).
  for (const [ticker, preco] of precosPersistidosDeOperacoes(operacoes)) precos.set(ticker, preco)

  return precos
}
