import { round2 } from '@/domain/money'
import type { Carteira, DesvioAtivo, MetasPorTicker, PrecoTeto, SituacaoDesvio } from './types'

/**
 * Alertas de desvio (RF16) — função **pura**.
 *
 * Compara o percentual atual de cada ativo com a meta efetiva e classifica a
 * situação em **subalocado** (oportunidade de compra), **sobrealocado**
 * (candidato a venda) ou **equilibrado** (dentro da tolerância).
 */

/** Tolerância padrão (em pontos percentuais) para considerar um ativo equilibrado. */
export const TOLERANCIA_DESVIO_PERCENT = 1

function classificar(desvioPercent: number, tolerancia: number): SituacaoDesvio {
  if (desvioPercent > tolerancia) return 'sobrealocado'
  if (desvioPercent < -tolerancia) return 'subalocado'
  return 'equilibrado'
}

/** Meta efetiva do ativo: override explícito ou, na ausência, o % atual. */
function metaEfetiva(metas: MetasPorTicker, ticker: string, percentualAtual: number): number {
  const meta = metas[ticker]
  return meta === undefined ? percentualAtual : meta
}

export interface CalcularDesviosOpcoes {
  /** Preço teto por ticker (centavos) — Seção 5.5. */
  precoTeto?: PrecoTeto
  /** Tolerância (pontos percentuais) para classificar como equilibrado. */
  toleranciaPercent?: number
}

/**
 * Calcula o desvio de cada ativo em relação à meta (RF16). O resultado é
 * ordenado do mais subalocado ao mais sobrealocado (menor desvio % primeiro).
 */
export function calcularDesvios(
  carteira: Carteira,
  metas: MetasPorTicker,
  opcoes: CalcularDesviosOpcoes = {},
): DesvioAtivo[] {
  const precoTeto = opcoes.precoTeto ?? {}
  const tolerancia = opcoes.toleranciaPercent ?? TOLERANCIA_DESVIO_PERCENT
  const patrimonioAtual = round2(carteira.reduce((acc, ativo) => acc + ativo.valorAtual, 0))

  return carteira
    .filter((ativo) => ativo.ticker.trim().length > 0)
    .map((ativo) => {
      const ticker = ativo.ticker.trim()
      const percentualAtual =
        patrimonioAtual > 0 ? round2((ativo.valorAtual / patrimonioAtual) * 100) : 0
      const metaPercent = round2(metaEfetiva(metas, ticker, percentualAtual))
      const valorAlvo = round2((patrimonioAtual * metaPercent) / 100)
      const desvioValor = round2(ativo.valorAtual - valorAlvo)
      const desvioPercent = round2(percentualAtual - metaPercent)
      const teto = precoTeto[ticker]
      const precoTetoValor = teto !== undefined && teto > 0 ? teto : null

      return {
        ticker,
        categoria: ativo.categoria,
        valorAtual: ativo.valorAtual,
        percentualAtual,
        metaPercent,
        valorAlvo,
        desvioValor,
        desvioPercent,
        situacao: classificar(desvioPercent, tolerancia),
        precoTeto: precoTetoValor,
        acimaDoTeto: precoTetoValor !== null && ativo.precoAtual > precoTetoValor,
      } satisfies DesvioAtivo
    })
    .sort((a, b) => a.desvioPercent - b.desvioPercent || a.ticker.localeCompare(b.ticker))
}
