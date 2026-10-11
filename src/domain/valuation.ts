import { round2 } from '@/domain/money'
import type { Consolidado, Valuation } from '@/domain/entities'

/**
 * Regras de valuation — módulo **puro** e testável.
 *
 * O alerta de oportunidade de compra compara a cotação atual com o **limite de
 * compra** derivado do preço teto e da margem de segurança:
 *
 *   limite = preço teto − (preço teto × margem ÷ 100)
 *
 * O alerta dispara quando a cotação atual é **menor ou igual** ao limite.
 * Dinheiro sempre em **centavos**; margem em pontos percentuais (ex.: `20` = 20%).
 */

/** Limite de compra em centavos: `teto − teto × margem ÷ 100`. */
export function limiteDeCompra(precoTeto: number, margemSeguranca: number): number {
  return round2(precoTeto - precoTeto * (margemSeguranca / 100))
}

/**
 * `true` quando a cotação atual está no limite de compra ou abaixo (oportunidade
 * de compra). Retorna `false` quando algum dado está ausente ou inválido
 * (cotação/teto ≤ 0, margem negativa), evitando falsos positivos.
 */
export function oportunidadeDeCompra(
  precoAtual: number | null,
  precoTeto: number | null,
  margemSeguranca: number | null,
): boolean {
  if (precoAtual === null || precoTeto === null || margemSeguranca === null) return false
  if (precoAtual <= 0 || precoTeto <= 0 || margemSeguranca < 0) return false
  return precoAtual <= limiteDeCompra(precoTeto, margemSeguranca)
}

/**
 * Tickers com oportunidade de compra, unindo a análise de valuation à cotação
 * atual do consolidado (comparação tolerante de ticker, maiúsculo e sem espaços).
 */
export function tickersComOportunidade(
  valuations: readonly Valuation[],
  consolidado: readonly Consolidado[],
): Set<string> {
  const cotacoes = new Map<string, number>()
  for (const linha of consolidado) {
    const ticker = linha.ticker.trim().toUpperCase()
    if (ticker.length > 0 && linha.precoAtual > 0) cotacoes.set(ticker, linha.precoAtual)
  }

  const oportunidades = new Set<string>()
  for (const valuation of valuations) {
    const ticker = valuation.ticker.trim().toUpperCase()
    if (ticker.length === 0 || oportunidades.has(ticker)) continue
    if (oportunidadeDeCompra(cotacoes.get(ticker) ?? null, valuation.precoTeto, valuation.margemSeguranca)) {
      oportunidades.add(ticker)
    }
  }
  return oportunidades
}
