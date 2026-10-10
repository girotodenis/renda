import { Loader2 } from 'lucide-react'
import { Suspense, lazy } from 'react'
import { Modal } from '@/components/Modal'
import { categoriaLabel } from '@/lib/categoria'
import { cn } from '@/lib/cn'
import { formatarDataBR } from '@/lib/dates'
import type { DetalheAtivo } from '@/lib/detalheAtivo'
import { classeValor, formatarCentavos, formatarPercentual } from '@/features/dashboard/formatters'
import type { Provento } from '@/types/domain'

/** Gráficos carregados sob demanda (Recharts fora do bundle inicial — RNF06). */
const DetalheAtivoGraficos = lazy(() =>
  import('@/features/dashboard/DetalheAtivoGraficos').then((modulo) => ({
    default: modulo.DetalheAtivoGraficos,
  })),
)

interface DetalheAtivoModalProps {
  /** Detalhe do ativo selecionado; `null` mantém o modal fechado. */
  detalhe: DetalheAtivo | null
  /** Proventos do extrato (para a série mensal do rodapé). */
  proventos: readonly Provento[]
  onClose: () => void
}

function formatarCentavosOuTraco(centavos: number | null): string {
  return centavos === null ? '—' : formatarCentavos(centavos)
}

/**
 * Modal de detalhe do ativo (RF10): menor/maior compra, preço médio, proventos
 * do período, valor investido e as duas visões de rentabilidade, com os
 * gráficos (decomposição do retorno e proventos por mês) no rodapé.
 */
export function DetalheAtivoModal({ detalhe, proventos, onClose }: DetalheAtivoModalProps) {
  const titulo = detalhe ? (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono">{detalhe.ticker}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        {categoriaLabel(detalhe.categoria)}
      </span>
    </span>
  ) : null

  return (
    <Modal open={detalhe !== null} onClose={onClose} titulo={titulo}>
      {detalhe ? <DetalheAtivoConteudo detalhe={detalhe} proventos={proventos} /> : null}
    </Modal>
  )
}

function DetalheAtivoConteudo({
  detalhe,
  proventos,
}: {
  detalhe: DetalheAtivo
  proventos: readonly Provento[]
}) {
  const periodo =
    detalhe.primeiraCompra
      ? `de ${formatarDataBR(detalhe.primeiraCompra)} até hoje`
      : 'sem compras registradas'

  // A Rentabilidade Total só agrega quando há lucro realizado (vendas de ciclos
  // encerrados); sem vendas ela coincide com a da posição e vira ruído.
  const possuiRealizado = detalhe.lucroRealizado !== 0 && detalhe.capitalAportado > 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metrica rotulo="Menor compra" valor={formatarCentavosOuTraco(detalhe.menorPrecoCompra)} />
        <Metrica rotulo="Maior compra" valor={formatarCentavosOuTraco(detalhe.maiorPrecoCompra)} />
        <Metrica rotulo="Preço médio" valor={formatarCentavos(detalhe.precoMedio)} />
        <Metrica rotulo="Preço atual" valor={formatarCentavos(detalhe.precoAtual)} />
        <Metrica rotulo="Valor investido" valor={formatarCentavos(detalhe.totalInvestido)} />
        <Metrica rotulo="Valor atual" valor={formatarCentavos(detalhe.valorAtual)} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Proventos no período</p>
        <p className="text-lg font-semibold tabular-nums text-slate-900">
          {formatarCentavos(detalhe.proventosNoPeriodo)}
        </p>
        <p className="text-xs text-slate-500">{periodo}</p>
      </div>

      <div className={cn('grid gap-3', possuiRealizado && 'sm:grid-cols-2')}>
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Rentabilidade da posição</p>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={cn(
                'text-lg font-semibold tabular-nums',
                classeValor(detalhe.rentabilidadePercent),
              )}
            >
              {formatarPercentual(detalhe.rentabilidadePercent)}
            </span>
            <span
              className={cn('text-sm font-medium tabular-nums', classeValor(detalhe.retornoPosicao))}
            >
              {formatarCentavos(detalhe.retornoPosicao)}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            (valor atual − investido + proventos) ÷ investido
          </p>
        </div>

        {possuiRealizado ? (
          <div className="rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Rentabilidade Total</p>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  classeValor(detalhe.retornoTotal),
                )}
              >
                {formatarPercentual(detalhe.rentabilidadeTotalPercent)}
              </span>
              <span
                className={cn('text-sm font-medium tabular-nums', classeValor(detalhe.retornoTotal))}
              >
                {formatarCentavos(detalhe.retornoTotal)}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              realizado {formatarCentavos(detalhe.lucroRealizado)} + variação{' '}
              {formatarCentavos(detalhe.lucroFlutuante)} + proventos{' '}
              {formatarCentavos(detalhe.proventosNoPeriodo)}
            </p>
            <p className="text-xs text-slate-500">÷ capital aportado (soma das compras)</p>
          </div>
        ) : null}
      </div>

      {possuiRealizado ? (
        <details className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Como é calculada a Rentabilidade Total?
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              A Rentabilidade Total considera o lucro de ciclos já encerrados (vendas), que a
              rentabilidade da posição não isola.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Retorno Total = Lucro Realizado + Variação + Proventos</li>
              <li>Rentabilidade Total = (Retorno Total ÷ Capital Aportado) × 100</li>
            </ul>
            <p>
              Capital aportado é a soma de todas as compras (quantidade × preço + taxas). Sem vendas,
              ele é igual ao valor investido e a Rentabilidade Total coincide com a da posição.
            </p>
          </div>
        </details>
      ) : null}

      <div className="border-t border-slate-200 pt-4">
        <Suspense fallback={<GraficosFallback />}>
          <DetalheAtivoGraficos detalhe={detalhe} proventos={proventos} />
        </Suspense>
      </div>
    </div>
  )
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-900">{valor}</p>
    </div>
  )
}

function GraficosFallback() {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando gráficos…
      </span>
    </div>
  )
}
