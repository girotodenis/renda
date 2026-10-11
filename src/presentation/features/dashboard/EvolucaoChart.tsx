import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EvolucaoPonto } from '@/domain/dashboard'
import { formatarCentavos, formatarCentavosCompacto } from '@/presentation/features/dashboard/formatters'

interface EvolucaoChartProps {
  serie: EvolucaoPonto[]
}

/**
 * Gráfico de evolução patrimonial (RF09) — linha a partir da aba `Historico`.
 * Carregado sob demanda (lazy) junto com o Recharts (RNF06).
 */
export function EvolucaoChart({ serie }: EvolucaoChartProps) {
  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h2 className="text-base font-semibold text-slate-900">Evolução patrimonial</h2>
        <p className="text-sm text-slate-500">
          Histórico de patrimônio, investimento e lucro ao longo do tempo.
        </p>
      </header>

      {serie.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-12 text-center text-sm text-slate-500">
          Ainda não há snapshots no Histórico. Eles são registrados automaticamente ao abrir o app.
        </p>
      ) : (
        <div
          className="mt-4 h-64 w-full"
          role="img"
          aria-label="Gráfico de evolução patrimonial"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="rotulo" tick={{ fontSize: 12 }} minTickGap={24} />
              <YAxis
                tickFormatter={(value) => formatarCentavosCompacto(Number(value))}
                tick={{ fontSize: 12 }}
                width={88}
              />
              <Tooltip formatter={(value) => formatarCentavos(Number(value))} />
              <Legend />
              <Line
                type="monotone"
                dataKey="patrimonioTotal"
                name="Patrimônio Total"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="totalInvestido"
                name="Total Investido"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="lucroAcumulado"
                name="Lucro Acumulado"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
