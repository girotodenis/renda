import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatarCentavos, formatarCentavosCompacto } from '@/presentation/features/dashboard/formatters'
import { serieDecomposicaoRetorno, serieProventosPorMes } from '@/domain/detalheAtivo'
import type { DetalheAtivo, PontoDecomposicao } from '@/domain/detalheAtivo'
import type { Provento } from '@/domain/entities'

/** Rótulos curtos para o eixo X do waterfall (o tooltip mantém o texto completo). */
const ROTULOS_CURTOS: Record<string, string> = {
  'Valor investido': 'Investido',
  'Lucro realizado': '+ Realizado',
  Variação: '+ Variação',
  Proventos: '+ Proventos',
  'Patrimônio final': 'Patrimônio',
  'Total recebido': 'Recebido',
}

function corDecomposicao(ponto: PontoDecomposicao, indice: number): string {
  if (indice === 0) return '#2563eb'
  if (ponto.rotulo === 'Patrimônio final' || ponto.rotulo === 'Total recebido') return '#1d4ed8'
  if (ponto.rotulo === 'Proventos') return '#0ea5e9'
  return ponto.valor >= 0 ? '#10b981' : '#ef4444'
}

interface WaterfallTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: PontoDecomposicao }>
}

function WaterfallTooltip({ active, payload }: WaterfallTooltipProps) {
  const ponto = payload?.[0]?.payload
  if (!active || !ponto) return null
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
      <p className="font-medium text-slate-700">{ponto.rotulo}</p>
      <p className="tabular-nums text-slate-700">{formatarCentavos(ponto.valor)}</p>
      <p className="tabular-nums text-slate-500">Acumulado: {formatarCentavos(ponto.acumulado)}</p>
    </div>
  )
}

interface DetalheAtivoGraficosProps {
  detalhe: DetalheAtivo
  /** Proventos do extrato (para a série mensal restrita ao ativo e à janela). */
  proventos: readonly Provento[]
}

/**
 * Gráficos do modal do ativo (rodapé, lado a lado): decomposição do retorno
 * (waterfall) e proventos por mês. Carregado sob demanda (lazy) junto com o
 * Recharts (RNF06).
 */
export function DetalheAtivoGraficos({ detalhe, proventos }: DetalheAtivoGraficosProps) {
  const decomposicao = useMemo(() => serieDecomposicaoRetorno(detalhe), [detalhe])
  const porMes = useMemo(
    () =>
      serieProventosPorMes(
        proventos,
        detalhe.ticker,
        detalhe.primeiraCompra,
        detalhe.dataReferencia,
      ),
    [proventos, detalhe.ticker, detalhe.primeiraCompra, detalhe.dataReferencia],
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Decomposição do retorno</h3>
        <p className="text-xs text-slate-500">Valor investido, lucros e proventos até o total.</p>
        <div className="mt-3 h-56 w-full" role="img" aria-label="Decomposição do retorno do ativo">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={decomposicao.map((ponto) => ({
                ...ponto,
                curto: ROTULOS_CURTOS[ponto.rotulo] ?? ponto.rotulo,
              }))}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="curto" tick={{ fontSize: 11 }} interval={0} />
              <YAxis
                tickFormatter={(value) => formatarCentavosCompacto(Number(value))}
                tick={{ fontSize: 11 }}
                width={72}
              />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <Tooltip cursor={{ fill: '#f1f5f9' }} content={<WaterfallTooltip />} />
              <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="valor" stackId="waterfall" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {decomposicao.map((ponto, indice) => (
                  <Cell key={ponto.rotulo} fill={corDecomposicao(ponto, indice)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Proventos por mês</h3>
        <p className="text-xs text-slate-500">Da primeira compra até hoje.</p>
        {porMes.length === 0 ? (
          <p className="flex h-56 items-center justify-center text-center text-sm text-slate-500">
            Sem proventos recebidos no período.
          </p>
        ) : (
          <div className="mt-3 h-56 w-full" role="img" aria-label="Proventos por mês do ativo">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porMes} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} interval={0} />
                <YAxis
                  tickFormatter={(value) => formatarCentavosCompacto(Number(value))}
                  tick={{ fontSize: 11 }}
                  width={72}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  formatter={(value) => formatarCentavos(Number(value))}
                />
                <Bar dataKey="valorTotal" name="Proventos" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  )
}
