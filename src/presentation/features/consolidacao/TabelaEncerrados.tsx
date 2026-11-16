import { PackageCheck } from 'lucide-react'
import { categoriaLabel } from '@/domain/categoria'
import type { PendenciaConsolidacao } from '@/domain/consolidacao'
import { formatarDataBR } from '@/domain/dates'
import { formatarBRL, fromCentavos } from '@/domain/money'
import { Pagination } from '@/presentation/components/Pagination'
import { usePagination } from '@/presentation/hooks/usePagination'

interface TabelaEncerradosProps {
  pendencias: PendenciaConsolidacao[]
  isOffline: boolean
  onConsolidar: (pendencia: PendenciaConsolidacao) => void
}

const ENCERRADOS_PAGE_SIZE = 10

function periodo(pendencia: PendenciaConsolidacao): string {
  const inicio = pendencia.primeiraCompra ? formatarDataBR(pendencia.primeiraCompra) : '—'
  const fim = pendencia.ultimaVenda ? formatarDataBR(pendencia.ultimaVenda) : '—'
  return `${inicio} – ${fim}`
}

/**
 * Tabela de ativos **encerrados** (100% vendidos) com pendência de consolidação
 * (§5.1). Itens com `impedimento` aparecem com o motivo e o botão desabilitado.
 */
export function TabelaEncerrados({ pendencias, isOffline, onConsolidar }: TabelaEncerradosProps) {
  const { page, pageItems, setPage, totalPages } = usePagination(
    pendencias,
    ENCERRADOS_PAGE_SIZE,
    pendencias.length,
  )

  if (pendencias.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-slate-500">
        Nenhum ativo encerrado pendente de consolidação.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="tabela-responsiva w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">
                Ticker
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                Categoria
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                Período
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Operações
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Proventos
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Total compras
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Total vendas
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Lucro realizado
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Total proventos
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Ação
              </th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((pendencia) => {
              const bloqueado = pendencia.impedimento !== null || isOffline
              return (
                <tr key={pendencia.ticker} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2 font-mono font-medium text-slate-900" data-card-title>
                    {pendencia.ticker}
                  </td>
                  <td className="px-4 py-2 text-slate-700" data-label="Categoria">
                    {categoriaLabel(pendencia.categoria)}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-700" data-label="Período">
                    {periodo(pendencia)}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums text-slate-700"
                    data-label="Operações"
                  >
                    {pendencia.operacoesParaAbsorver}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums text-slate-700"
                    data-label="Proventos"
                  >
                    {pendencia.proventosParaAbsorver}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums text-slate-700"
                    data-label="Total compras"
                  >
                    {formatarBRL(fromCentavos(pendencia.totalCompras))}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums text-slate-700"
                    data-label="Total vendas"
                  >
                    {formatarBRL(fromCentavos(pendencia.totalVendas))}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums text-slate-700"
                    data-label="Lucro realizado"
                  >
                    {formatarBRL(fromCentavos(pendencia.lucroRealizado))}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums text-slate-700"
                    data-label="Total proventos"
                  >
                    {formatarBRL(fromCentavos(pendencia.totalProventos))}
                  </td>
                  <td className="px-4 py-2" data-actions>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => onConsolidar(pendencia)}
                        disabled={bloqueado}
                        title={
                          pendencia.impedimento ??
                          (isOffline ? 'Conecte-se para consolidar.' : undefined)
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PackageCheck className="h-3.5 w-3.5" aria-hidden />
                        Consolidar
                      </button>
                      {pendencia.impedimento ? (
                        <p className="max-w-[16rem] text-right text-xs text-red-700">
                          {pendencia.impedimento}
                        </p>
                      ) : isOffline ? (
                        <p className="text-right text-xs text-amber-700">Sem conexão</p>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <Pagination
          page={page}
          pageSize={ENCERRADOS_PAGE_SIZE}
          total={pendencias.length}
          onPageChange={setPage}
        />
      ) : null}
    </>
  )
}
