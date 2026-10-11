import { round2 } from '@/domain/money'
import type { Carteira, ItemAporte, MetasPorTicker, RebalanceamentoCompleto } from './types'

/**
 * Rebalanceamento completo — compras **e** vendas (Seção 5.4) — função **pura**.
 *
 * ```
 * Desvio[i] = Valor Atual[i] − Valor Alvo[i]   (Valor Alvo = Patrimônio × Meta%)
 * Desvio > 0 → vender  floor(Desvio / Preço Atual)
 * Desvio < 0 → comprar floor(|Desvio| / Preço Atual)
 * ```
 *
 * Ativos sem meta explícita mantêm o percentual atual (não são perturbados),
 * evitando sugerir a venda integral de posições não configuradas.
 *
 * ⚠️ Vendas geram apuração de IR e custos — a UI deve exibir `AVISO_IR_VENDAS`
 * antes de apresentar/confirmar qualquer venda.
 */

/** Aviso obrigatório exibido antes de sugerir vendas (Seção 5.4). */
export const AVISO_IR_VENDAS =
  'Vendas geram apuração de imposto de renda (IR) e custos operacionais. ' +
  'Confira o prejuízo a compensar e as obrigações fiscais antes de executar.'

/** Meta efetiva do ativo: override explícito ou, na ausência, o % atual. */
function metaEfetiva(metas: MetasPorTicker, ticker: string, percentualAtual: number): number {
  const meta = metas[ticker]
  return meta === undefined ? percentualAtual : meta
}

/** Rebalanceamento completo: sugere vendas (sobrealocados) e compras (subalocados). */
export function rebalanceamentoCompleto(
  carteira: Carteira,
  metas: MetasPorTicker,
): RebalanceamentoCompleto {
  const patrimonioAtual = round2(carteira.reduce((acc, ativo) => acc + ativo.valorAtual, 0))

  const compras: ItemAporte[] = []
  const vendas: ItemAporte[] = []

  for (const ativo of carteira) {
    const ticker = ativo.ticker.trim()
    if (ticker.length === 0 || ativo.precoAtual <= 0) continue

    const percentualAtual = patrimonioAtual > 0 ? (ativo.valorAtual / patrimonioAtual) * 100 : 0
    const meta = metaEfetiva(metas, ticker, percentualAtual)
    const valorAlvo = round2((patrimonioAtual * meta) / 100)
    const desvio = round2(ativo.valorAtual - valorAlvo)

    if (desvio > 0) {
      const qtd = Math.floor(desvio / ativo.precoAtual)
      if (qtd > 0) {
        vendas.push({ ticker, qtd, valorAlocado: Math.round(qtd * ativo.precoAtual) })
      }
    } else if (desvio < 0) {
      const qtd = Math.floor(Math.abs(desvio) / ativo.precoAtual)
      if (qtd > 0) {
        compras.push({ ticker, qtd, valorAlocado: Math.round(qtd * ativo.precoAtual) })
      }
    }
  }

  const porTicker = (a: ItemAporte, b: ItemAporte): number => a.ticker.localeCompare(b.ticker)
  return { compras: compras.sort(porTicker), vendas: vendas.sort(porTicker) }
}
