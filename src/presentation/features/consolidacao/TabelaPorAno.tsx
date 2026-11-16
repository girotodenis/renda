import { PackageCheck } from 'lucide-react'
import { categoriaLabel } from '@/domain/categoria'
import type { AnoPendente, PendenciaConsolidacao } from '@/domain/consolidacao'
import { formatarBRL, fromCentavos } from '@/domain/money'
import { Accordion } from '@/presentation/components/Accordion'

interface TabelaPorAnoProps {
  pendencias: PendenciaConsolidacao[]
  isOffline: boolean
  onConsolidar: (pendencia: PendenciaConsolidacao, ano: AnoPendente) => void
}

function rotuloModo(ano: AnoPendente): string {
  return ano.modo === 'Completo' ? 'Completo' : 'Somente proventos'
}

/**
 * Ativos com posição aberta — consolidação **por ano** (§5.1), apenas anos
 * anteriores ao corrente. Cada linha mostra o modo sugerido: `Completo` para
 * anos auto-contidos e `Somente proventos` quando a posição fica aberta no ano.
 */
export function TabelaPorAno({ pendencias, isOffline, onConsolidar }: TabelaPorAnoProps) {
  if (pendencias.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-slate-500">
        Nenhum ano pendente em ativos com posição aberta.
      </p>
    )
  }

  return (
    <div className="space-y-2 p-4">
      {pendencias.map((pendencia) => (
        <Accordion
          key={pendencia.ticker}
          titulo={pendencia.ticker}
          descricao={`${categoriaLabel(pendencia.categoria)} · ${pendencia.anos.length} ano(s) com pendência`}
        >
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="tabela-responsiva w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Ano
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Modo
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Operações
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Proventos
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendencia.anos.map((ano) => (
                    <tr key={ano.ano} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 tabular-nums font-medium text-slate-900" data-card-title>
                        {ano.ano}
                      </td>
                      <td className="px-3 py-2 text-slate-700" data-label="Modo">
                        {rotuloModo(ano)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums text-slate-700"
                        data-label="Operações"
                      >
                        {ano.operacoesParaAbsorver}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums text-slate-700"
                        data-label="Proventos"
                      >
                        {ano.proventosParaAbsorver}
                      </td>
                      <td className="px-3 py-2" data-actions>
                        <div className="flex flex-col items-end gap-1">
                          <button
                            type="button"
                            onClick={() => onConsolidar(pendencia, ano)}
                            disabled={ano.impedimento !== null || isOffline}
                            title={
                              ano.impedimento ??
                              (isOffline ? 'Conecte-se para consolidar.' : undefined)
                            }
                            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <PackageCheck className="h-3.5 w-3.5" aria-hidden />
                            Consolidar o ano
                          </button>
                          {ano.impedimento ? (
                            <p className="max-w-[16rem] text-right text-xs text-red-700">
                              {ano.impedimento}
                            </p>
                          ) : isOffline ? (
                            <p className="text-right text-xs text-amber-700">Sem conexão</p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500">
              Totais atuais do ativo: compras{' '}
              {formatarBRL(fromCentavos(pendencia.totalCompras))} · vendas{' '}
              {formatarBRL(fromCentavos(pendencia.totalVendas))} · lucro realizado{' '}
              {formatarBRL(fromCentavos(pendencia.lucroRealizado))} · proventos{' '}
              {formatarBRL(fromCentavos(pendencia.totalProventos))}.
            </p>
          </div>
        </Accordion>
      ))}
    </div>
  )
}
