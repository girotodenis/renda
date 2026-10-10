import { useMemo } from 'react'
import { categoriaLabel } from '@/lib/categoria'
import { cn } from '@/lib/cn'
import { STATUS_COTACAO_LABELS } from '@/lib/cotacoes'
import type { CotacaoResolvida } from '@/lib/cotacoes'
import type { Consolidado } from '@/types/domain'
import { agruparAtivosPorCategoria } from '@/lib/dashboard'
import type { GrupoCategoria } from '@/lib/dashboard'
import {
  classeValor,
  formatarCentavos,
  formatarPercentual,
} from '@/features/dashboard/formatters'

interface TabelaAtivosProps {
  /** Posições abertas (RF10), exibidas em uma tabela por categoria. */
  ativos: Consolidado[]
  /** Cotações resolvidas por ticker (fonte + status — RF19/RNF04). */
  cotacoes?: ReadonlyMap<string, CotacaoResolvida>
  /**
   * Callback ao clicar no ticker de um ativo (abre o detalhe — RF10).
   * Quando ausente, o ticker é exibido como texto simples (sem interação).
   */
  onSelecionarAtivo?: (ticker: string) => void
}

/**
 * Tabela de ativos da carteira (RF10): uma tabela por categoria, cada uma com
 * um **consolidador** no topo (investido, valor atual, lucro e % da carteira).
 */
export function TabelaAtivos({ ativos, cotacoes, onSelecionarAtivo }: TabelaAtivosProps) {
  const grupos = useMemo(() => agruparAtivosPorCategoria(ativos), [ativos])

  if (ativos.length === 0) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Meus ativos</h2>
        </div>
        <p className="px-4 py-6 text-sm text-slate-500">
          Lance operações para visualizar seus ativos aqui.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {grupos.map((grupo) => (
        <CategoriaAtivos
          key={grupo.categoria}
          grupo={grupo}
          cotacoes={cotacoes}
          onSelecionarAtivo={onSelecionarAtivo}
        />
      ))}
    </div>
  )
}

function CategoriaAtivos({
  grupo,
  cotacoes,
  onSelecionarAtivo,
}: {
  grupo: GrupoCategoria
  cotacoes?: ReadonlyMap<string, CotacaoResolvida>
  onSelecionarAtivo?: (ticker: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">{categoriaLabel(grupo.categoria)}</h2>
        <span className="text-sm text-slate-500">
          {grupo.quantidadePosicoes} {grupo.quantidadePosicoes === 1 ? 'posição' : 'posições'}
        </span>
      </header>

      {/* Consolidador da categoria (totais) */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-100 sm:grid-cols-4">
        <ConsolidadoCell rotulo="Investido" valor={formatarCentavos(grupo.totalInvestido)} />
        <ConsolidadoCell rotulo="Valor atual" valor={formatarCentavos(grupo.valorAtual)} />
        <ConsolidadoCell
          rotulo="Lucro"
          valor={formatarCentavos(grupo.lucroPrejuizo)}
          classe={classeValor(grupo.lucroPrejuizo)}
          sub={formatarPercentual(grupo.lucroPrejuizoPercent)}
        />
        <ConsolidadoCell rotulo="% da carteira" valor={formatarPercentual(grupo.percentualCarteira)} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Posições de {categoriaLabel(grupo.categoria)} com preço médio, cotação atual, total
            investido, valor total, lucro e variação.
          </caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Quantidade</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Preço Médio</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Cotação Atual</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Total Investido</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Valor Total</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Lucro</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Variação</th>
            </tr>
          </thead>
          <tbody>
            {grupo.ativos.map((ativo) => {
              const cotacao = cotacoes?.get(ativo.ticker)
              return (
                <tr key={ativo.ticker} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {onSelecionarAtivo ? (
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        onClick={() => onSelecionarAtivo(ativo.ticker)}
                        className="rounded font-mono font-medium text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        {ativo.ticker}
                      </button>
                    ) : (
                      <span className="font-mono font-medium text-slate-900">{ativo.ticker}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {ativo.quantidadeAtual.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {formatarCentavos(ativo.precoMedio)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    <span className="block">{formatarCentavos(ativo.precoAtual)}</span>
                    {cotacao && cotacao.status !== 'disponivel' ? (
                      <CotacaoSelo status={cotacao.status} />
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {formatarCentavos(ativo.totalInvestido)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                    {formatarCentavos(ativo.valorAtual)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2 text-right tabular-nums font-medium',
                      classeValor(ativo.lucroPrejuizo),
                    )}
                  >
                    <span className="block">{formatarCentavos(ativo.lucroPrejuizo)}</span>
                    <span className="block text-xs">
                      {formatarPercentual(ativo.lucroPrejuizoPercent)}
                    </span>
                  </td>
                  {/* Variação de preço: (preço atual − preço médio) ÷ preço médio = lucroPrejuizoPercent. */}
                  <td
                    className={cn(
                      'px-4 py-2 text-right tabular-nums font-medium',
                      classeValor(ativo.lucroPrejuizoPercent),
                    )}
                  >
                    {formatarPercentual(ativo.lucroPrejuizoPercent)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Célula do consolidador (rótulo + valor, com sub e cor opcionais). */
function ConsolidadoCell({
  rotulo,
  valor,
  sub,
  classe,
}: {
  rotulo: string
  valor: string
  sub?: string
  classe?: string
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={cn('text-sm font-semibold tabular-nums text-slate-900', classe)}>{valor}</p>
      {sub ? <p className={cn('text-xs tabular-nums', classe)}>{sub}</p> : null}
    </div>
  )
}

/** Selo acessível com a fonte/estado da cotação (RF19/RNF04). */
function CotacaoSelo({ status }: { status: 'manual' | 'estimada' | 'indisponivel' }) {
  const indisponivel = status === 'indisponivel'
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        indisponivel ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600',
      )}
      title={
        indisponivel
          ? 'Cotação indisponível — exibindo o preço médio como referência.'
          : 'Preço informado manualmente ou estimado.'
      }
    >
      {STATUS_COTACAO_LABELS[status]}
    </span>
  )
}
