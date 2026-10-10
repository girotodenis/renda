import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { categoriaLabel } from '@/lib/categoria'
import { cn } from '@/lib/cn'
import type { DesvioAtivo } from '@/lib/rebalanceamento'
import { classeValor, formatarCentavos, formatarPercentual } from '@/features/dashboard/formatters'

interface TabelaDesviosProps {
  desvios: DesvioAtivo[]
}

const SITUACAO_LABELS: Record<DesvioAtivo['situacao'], string> = {
  subalocado: 'Subalocado · compra',
  sobrealocado: 'Sobrealocado · venda',
  equilibrado: 'Equilibrado',
}

const SITUACAO_CLASSES: Record<DesvioAtivo['situacao'], string> = {
  subalocado: 'bg-sky-50 text-sky-700',
  sobrealocado: 'bg-amber-50 text-amber-700',
  equilibrado: 'bg-slate-100 text-slate-600',
}

function SituacaoIcone({ situacao }: { situacao: DesvioAtivo['situacao'] }) {
  if (situacao === 'subalocado') return <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
  if (situacao === 'sobrealocado') return <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
  return <Minus className="h-3.5 w-3.5" aria-hidden />
}

/**
 * Alertas de desvio (RF16): destaca ativos **subalocados** (oportunidade de
 * compra) e **sobrealocados** (candidatos a venda) em relação à meta.
 */
export function TabelaDesvios({ desvios }: TabelaDesviosProps) {
  if (desvios.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Alertas de desvio</h2>
        <p className="mt-1 text-sm text-slate-500">
          Nenhum ativo na carteira para comparar com as metas.
        </p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">Alertas de desvio</h2>
        <p className="text-sm text-slate-500">
          Ativos abaixo da meta são oportunidades de compra; acima, candidatos a venda (RF16).
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
              <th scope="col" className="px-4 py-2 font-semibold">Classe</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Meta %</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">% Atual</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Desvio %</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Valor Atual</th>
              <th scope="col" className="px-4 py-2 font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {desvios.map((desvio) => (
              <tr key={desvio.ticker} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono font-medium text-slate-900">
                  {desvio.ticker}
                  {desvio.acimaDoTeto ? (
                    <span
                      className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                      title="Cotação acima do preço teto — excluído do aporte"
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Acima do teto
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-slate-600">{categoriaLabel(desvio.categoria)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {formatarPercentual(desvio.metaPercent)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {formatarPercentual(desvio.percentualAtual)}
                </td>
                <td
                  className={cn(
                    'px-4 py-2 text-right tabular-nums font-medium',
                    classeValor(desvio.desvioValor),
                  )}
                >
                  {formatarPercentual(desvio.desvioPercent)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {formatarCentavos(desvio.valorAtual)}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                      SITUACAO_CLASSES[desvio.situacao],
                    )}
                  >
                    <SituacaoIcone situacao={desvio.situacao} />
                    {SITUACAO_LABELS[desvio.situacao]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
