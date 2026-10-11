import { useMemo, useState } from 'react'
import { Pagination } from '@/components/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { cn } from '@/lib/cn'
import {
  agruparProventosPorMes,
  agruparProventosPorTicker,
  agruparProventosPorTipo,
  anosComProventos,
  filtrarProventos,
  totalProventos,
} from '@/lib/dashboard'
import type { AgregadoProvento } from '@/lib/dashboard'
import { formatarCentavos } from '@/features/dashboard/formatters'
import type { Provento } from '@/types/domain'

type Modo = 'anual' | 'mensal'

const rotuloModo: Record<Modo, string> = {
  anual: 'Anual',
  mensal: 'Mensal',
}

/** Registros exibidos por página na lista "Por ticker" do extrato. */
const TICKER_PAGE_SIZE = 5

interface ExtratoProventosProps {
  proventos: Provento[]
}

/**
 * Extrato de proventos (RF11) — visualização **anual e mensal**, agregada por
 * ticker e por tipo (Dividendo/JCP/Rendimento). Módulo puro em `lib/dashboard`.
 */
export function ExtratoProventos({ proventos }: ExtratoProventosProps) {
  const [modo, setModo] = useState<Modo>('anual')
  const [anoSelecionado, setAnoSelecionado] = useState('')
  const [mesSelecionado, setMesSelecionado] = useState('')

  const anos = useMemo(() => anosComProventos(proventos), [proventos])
  const ano = anoSelecionado || anos[0] || ''

  const proventosDoAno = useMemo(
    () => (ano ? filtrarProventos(proventos, { ano }) : []),
    [proventos, ano],
  )
  const meses = useMemo(() => agruparProventosPorMes(proventosDoAno), [proventosDoAno])
  const mes = mesSelecionado || meses[0]?.chave || ''

  const filtrados = useMemo(
    () =>
      modo === 'anual' ? proventosDoAno : mes ? filtrarProventos(proventosDoAno, { mes }) : [],
    [modo, proventosDoAno, mes],
  )

  const porTicker = useMemo(() => agruparProventosPorTicker(filtrados), [filtrados])
  const porTipo = useMemo(() => agruparProventosPorTipo(filtrados), [filtrados])
  const total = totalProventos(filtrados)

  const temProventos = proventos.length > 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Extrato de proventos</h2>
          <p className="text-sm text-slate-500">
            Dividendos, JCP e rendimentos por ticker e por tipo.
          </p>
        </div>

        {temProventos ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Ano
              <select
                value={ano}
                onChange={(event) => {
                  setAnoSelecionado(event.target.value)
                  setMesSelecionado('')
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
              >
                {anos.map((opcao) => (
                  <option key={opcao} value={opcao}>
                    {opcao}
                  </option>
                ))}
              </select>
            </label>

            <div
              role="group"
              aria-label="Período do extrato"
              className="inline-flex self-start rounded-md border border-slate-300 bg-slate-50 p-0.5"
            >
              {(['anual', 'mensal'] as const).map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  onClick={() => setModo(opcao)}
                  aria-pressed={modo === opcao}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-semibold transition-colors',
                    modo === opcao
                      ? 'bg-white text-brand-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  {rotuloModo[opcao]}
                </button>
              ))}
            </div>

            {modo === 'mensal' ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Mês
                <select
                  value={mes}
                  onChange={(event) => setMesSelecionado(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                >
                  {meses.map((opcao) => (
                    <option key={opcao.chave} value={opcao.chave}>
                      {opcao.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </header>

      {!temProventos ? (
        <p className="mt-4 text-sm text-slate-500">
          Nenhum provento lançado ainda. Registre dividendos, JCP e rendimentos para ver o extrato.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Total no período: <strong className="text-slate-900">{formatarCentavos(total)}</strong>
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <TabelaAgregado
              titulo="Por ticker"
              itens={porTicker}
              vazioRotulo="—"
              pageSize={TICKER_PAGE_SIZE}
            />
            <TabelaAgregado titulo="Por tipo" itens={porTipo} vazioRotulo="—" />
          </div>
          {modo === 'anual' ? (
            <TabelaAgregado titulo="Por mês" itens={meses} vazioRotulo="—" />
          ) : null}
        </div>
      )}
    </section>
  )
}

interface TabelaAgregadoProps {
  titulo: string
  itens: AgregadoProvento[]
  vazioRotulo: string
  /** Quando definido, exibe a lista paginada em blocos deste tamanho. */
  pageSize?: number
}

function TabelaAgregado({ titulo, itens, vazioRotulo, pageSize }: TabelaAgregadoProps) {
  const { page, pageItems, setPage } = usePagination(itens, pageSize ?? (itens.length || 1), itens)
  const visiveis = pageSize ? pageItems : itens

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      </div>
      {itens.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{vazioRotulo}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{titulo}</caption>
          <tbody>
            {visiveis.map((item) => (
              <tr key={item.chave} className="border-t border-slate-100 first:border-t-0">
                <th scope="row" className="px-4 py-2 text-left font-medium text-slate-700">
                  {item.rotulo}
                </th>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                  {formatarCentavos(item.valorTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pageSize !== undefined && itens.length > pageSize ? (
        <Pagination page={page} pageSize={pageSize} total={itens.length} onPageChange={setPage} />
      ) : null}
    </div>
  )
}
