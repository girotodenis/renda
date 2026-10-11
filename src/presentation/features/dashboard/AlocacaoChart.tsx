import { useState } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { cn } from '@/presentation/cn'
import type { AlocacaoItem } from '@/domain/dashboard'
import { formatarCentavos, formatarPercentual } from '@/presentation/features/dashboard/formatters'

/** Paleta usada nos gráficos (consistente entre as séries). */
const CORES = [
  '#2563eb',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#64748b',
  '#ec4899',
]

type Modo = 'categoria' | 'ativo'

interface AlocacaoChartProps {
  porCategoria: AlocacaoItem[]
  porAtivo: AlocacaoItem[]
}

/**
 * Gráfico de alocação da carteira (RF08) — rosca/pizza por categoria ou por
 * ativo. Carregado sob demanda (lazy) junto com o Recharts (RNF06).
 */
export function AlocacaoChart({ porCategoria, porAtivo }: AlocacaoChartProps) {
  const [modo, setModo] = useState<Modo>('categoria')
  const itens = modo === 'categoria' ? porCategoria : porAtivo

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Alocação da carteira</h2>
          <p className="text-sm text-slate-500">Distribuição por categoria ou por ativo.</p>
        </div>
        <div
          role="group"
          aria-label="Agrupar alocação por"
          className="inline-flex self-start rounded-md border border-slate-300 bg-slate-50 p-0.5"
        >
          <button
            type="button"
            onClick={() => setModo('categoria')}
            aria-pressed={modo === 'categoria'}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-semibold transition-colors',
              modo === 'categoria'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900',
            )}
          >
            Por categoria
          </button>
          <button
            type="button"
            onClick={() => setModo('ativo')}
            aria-pressed={modo === 'ativo'}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-semibold transition-colors',
              modo === 'ativo'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900',
            )}
          >
            Por ativo
          </button>
        </div>
      </header>

      {itens.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-12 text-sm text-slate-500">
          Sem posições abertas para exibir a alocação.
        </p>
      ) : (
        <>
          <div
            className="mt-4 h-64 w-full"
            role="img"
            aria-label={`Gráfico de alocação por ${modo === 'categoria' ? 'categoria' : 'ativo'}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={itens}
                  dataKey="valor"
                  nameKey="rotulo"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={1}
                >
                  {itens.map((item, index) => (
                    <Cell key={item.chave} fill={CORES[index % CORES.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatarCentavos(Number(value))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-2 space-y-1 text-sm">
            {itens.map((item, index) => (
              <li key={item.chave} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: CORES[index % CORES.length] }}
                    aria-hidden
                  />
                  <span className="truncate font-medium text-slate-700">{item.rotulo}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {formatarCentavos(item.valor)} · {formatarPercentual(item.percentual)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
