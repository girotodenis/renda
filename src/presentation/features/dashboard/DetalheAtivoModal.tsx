import { Loader2 } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { categoriaLabel } from '@/lib/categoria'
import { cn } from '@/lib/cn'
import { formatarDataBR } from '@/lib/dates'
import type { DetalheAtivo } from '@/lib/detalheAtivo'
import { eventosDeOperacoes, isTipoEventoCorporativo } from '@/lib/eventosCorporativos'
import { classeValor, formatarCentavos, formatarPercentual } from '@/features/dashboard/formatters'
import type { Operacao, Provento } from '@/types/domain'
import { DetalheAtivoEventos } from './DetalheAtivoEventos'
import { DetalheAtivoOperacoes } from './DetalheAtivoOperacoes'
import { DetalheAtivoProventos } from './DetalheAtivoProventos'

/** Gráficos carregados sob demanda (Recharts fora do bundle inicial — RNF06). */
const DetalheAtivoGraficos = lazy(() =>
  import('@/features/dashboard/DetalheAtivoGraficos').then((modulo) => ({
    default: modulo.DetalheAtivoGraficos,
  })),
)

/** Abas do modal do ativo: resumo + listas editáveis por tipo de lançamento. */
type AbaId = 'resumo' | 'operacoes' | 'proventos' | 'eventos'

interface DetalheAtivoModalProps {
  /** Detalhe do ativo selecionado; `null` mantém o modal fechado. */
  detalhe: DetalheAtivo | null
  /** Operações do dashboard (base das abas Operações e Eventos). */
  operacoes: readonly Operacao[]
  /** Proventos do extrato (Resumo + aba Proventos). */
  proventos: readonly Provento[]
  /** Recarrega os dados do dashboard após registrar/editar/excluir um lançamento. */
  onChanged: () => Promise<void>
  onClose: () => void
}

function formatarCentavosOuTraco(centavos: number | null): string {
  return centavos === null ? '—' : formatarCentavos(centavos)
}

/**
 * Modal de detalhe do ativo (RF10) com abas: **Resumo** (menor/maior compra,
 * preço médio, proventos do período, valor investido, as duas visões de
 * rentabilidade e os gráficos), **Operações**, **Proventos** e **Eventos**.
 *
 * As três últimas abas listam os lançamentos do ticker e permitem cadastrar,
 * editar e excluir sem sair do dashboard; após cada escrita os dados do
 * dashboard são recarregados (`onChanged`).
 */
export function DetalheAtivoModal({
  detalhe,
  operacoes,
  proventos,
  onChanged,
  onClose,
}: DetalheAtivoModalProps) {
  const [aba, setAba] = useState<AbaId>('resumo')
  const ticker = detalhe?.ticker ?? null

  // Reabre sempre na aba Resumo ao trocar de ativo.
  useEffect(() => {
    setAba('resumo')
  }, [ticker])

  const contadores = useMemo(() => {
    if (!detalhe) return { operacoes: 0, proventos: 0, eventos: 0 }
    const alvo = detalhe.ticker.trim().toUpperCase()
    const operacoesDoAtivo = operacoes.filter(
      (operacao) => operacao.ticker.trim().toUpperCase() === alvo,
    )
    return {
      operacoes: operacoesDoAtivo.filter((operacao) => !isTipoEventoCorporativo(operacao.tipo))
        .length,
      proventos: proventos.filter((provento) => provento.ticker.trim().toUpperCase() === alvo)
        .length,
      eventos: eventosDeOperacoes(operacoesDoAtivo).length,
    }
  }, [detalhe, operacoes, proventos])

  const titulo = detalhe ? (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono">{detalhe.ticker}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        {categoriaLabel(detalhe.categoria)}
      </span>
    </span>
  ) : null

  return (
    <Modal open={detalhe !== null} onClose={onClose} titulo={titulo} className="max-w-5xl">
      {detalhe ? (
        <div className="space-y-4">
          <BarraAbas aba={aba} onChange={setAba} contadores={contadores} />

          {aba === 'resumo' ? (
            <div
              role="tabpanel"
              id="painel-resumo"
              aria-labelledby="aba-resumo"
              className="space-y-4"
            >
              <DetalheAtivoResumo detalhe={detalhe} proventos={proventos} />
            </div>
          ) : null}

          {aba === 'operacoes' ? (
            <div role="tabpanel" id="painel-operacoes" aria-labelledby="aba-operacoes">
              <DetalheAtivoOperacoes
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                operacoes={operacoes}
                onChanged={onChanged}
              />
            </div>
          ) : null}

          {aba === 'proventos' ? (
            <div role="tabpanel" id="painel-proventos" aria-labelledby="aba-proventos">
              <DetalheAtivoProventos
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                proventos={proventos}
                onChanged={onChanged}
              />
            </div>
          ) : null}

          {aba === 'eventos' ? (
            <div role="tabpanel" id="painel-eventos" aria-labelledby="aba-eventos">
              <DetalheAtivoEventos
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                operacoes={operacoes}
                onChanged={onChanged}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

interface BarraAbasProps {
  aba: AbaId
  onChange: (aba: AbaId) => void
  contadores: { operacoes: number; proventos: number; eventos: number }
}

/** Barra de abas acessível (`role="tablist"`) com contagem por lista. */
function BarraAbas({ aba, onChange, contadores }: BarraAbasProps) {
  const abas: readonly { id: AbaId; rotulo: string; contagem?: number }[] = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'operacoes', rotulo: 'Operações', contagem: contadores.operacoes },
    { id: 'proventos', rotulo: 'Proventos', contagem: contadores.proventos },
    { id: 'eventos', rotulo: 'Eventos', contagem: contadores.eventos },
  ]

  return (
    <div
      role="tablist"
      aria-label="Seções do ativo"
      className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
    >
      {abas.map((item) => {
        const ativa = aba === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`aba-${item.id}`}
            aria-selected={ativa}
            aria-controls={`painel-${item.id}`}
            onClick={() => onChange(item.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
              ativa ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {item.rotulo}
            {item.contagem !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  ativa ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600',
                )}
              >
                {item.contagem}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Aba **Resumo** do modal: métricas do ativo, proventos do período, as duas
 * visões de rentabilidade e os gráficos (decomposição do retorno e proventos
 * por mês).
 */
export function DetalheAtivoResumo({
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
