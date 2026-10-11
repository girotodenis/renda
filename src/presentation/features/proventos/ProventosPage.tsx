import { Coins, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { Pagination } from '@/components/Pagination'
import { ExtratoProventos } from '@/features/dashboard/ExtratoProventos'
import { ProventoForm } from '@/features/proventos/ProventoForm'
import { toProventoPayload } from '@/features/proventos/proventoSchema'
import type { ProventoFormOutput } from '@/features/proventos/proventoSchema'
import { usePagination } from '@/hooks/usePagination'
import { categoriaLabel } from '@/lib/categoria'
import { formatarDataBR } from '@/lib/dates'
import { formatarBRL, fromCentavos } from '@/lib/money'
import { capturarSnapshot } from '@/services/dashboard'
import { proventosRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { describeSheetsError } from '@/services/sheets'
import type { Provento } from '@/types/domain'

/** Estado do formulário: fechado, novo lançamento ou edição de um provento. */
type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; provento: Provento }

/** Registros exibidos por página na tabela de proventos. */
const PROVENTOS_PAGE_SIZE = 20

function byMostRecent(a: Provento, b: Provento): number {
  return b.dataPagamento.localeCompare(a.dataPagamento) || a.ticker.localeCompare(b.ticker)
}

/**
 * CRUD de proventos (dividendos, JCP e rendimentos) — RF05/RF06.
 *
 * Após cada escrita o cache da aba é invalidado e a lista é relida da API,
 * garantindo que o lançamento apareça imediatamente, sem duplicidade (ID
 * único por linha).
 */
export function ProventosPage() {
  const { workspace, ensureAccessToken } = useAuth()
  const [proventos, setProventos] = useState<Provento[] | null>(null)
  const [formState, setFormState] = useState<FormState>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filtroTicker, setFiltroTicker] = useState('')

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure uma planilha antes de lançar proventos.')
      return null
    }
    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return null
    }
    return { accessToken: token, spreadsheetId: workspace.spreadsheetId }
  }, [workspace, ensureAccessToken])

  const load = useCallback(
    async (forceRefresh = false) => {
      const context = await resolveContext()
      if (!context) return
      setIsLoading(true)
      setError(null)
      try {
        setProventos(await proventosRepo.list(context, { forceRefresh }))
      } catch (loadError) {
        setError(describeSheetsError(loadError))
      } finally {
        setIsLoading(false)
      }
    },
    [resolveContext],
  )

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Registra um snapshot no `Historico` (Seção 2) após salvar proventos.
   * Best-effort: falhas não bloqueiam o lançamento já salvo (RNF04).
   */
  async function atualizarHistorico(context: RepositoryContext) {
    try {
      await capturarSnapshot(context)
    } catch {
      // Snapshot é best-effort — não bloqueia o provento já salvo.
    }
  }

  async function handleSubmit(values: ProventoFormOutput) {
    const context = await resolveContext()
    if (!context || formState.mode === 'closed') return

    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (formState.mode === 'create') {
        await proventosRepo.append(context, {
          id: proventosRepo.newId(),
          ...toProventoPayload(values),
        })
        setNotice('Provento registrado com sucesso.')
      } else {
        await proventosRepo.update(context, {
          ...toProventoPayload(values),
          id: formState.provento.id,
        })
        setNotice('Provento atualizado com sucesso.')
      }
      setProventos(await proventosRepo.refresh(context))
      await atualizarHistorico(context)
      setFormState({ mode: 'closed' })
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(provento: Provento) {
    const confirmed = window.confirm(
      `Excluir o provento de ${provento.ticker} pago em ${formatarDataBR(provento.dataPagamento)}?`,
    )
    if (!confirmed) return

    const context = await resolveContext()
    if (!context) return

    setDeletingId(provento.id)
    setError(null)
    setNotice(null)
    try {
      await proventosRepo.remove(context, provento.id)
      setProventos(await proventosRepo.refresh(context))
      await atualizarHistorico(context)
      setNotice('Provento excluído com sucesso.')
    } catch (deleteError) {
      setError(describeSheetsError(deleteError))
    } finally {
      setDeletingId(null)
    }
  }

  const sorted = useMemo(() => (proventos ? [...proventos].sort(byMostRecent) : []), [proventos])

  /** Tickers distintos presentes nos lançamentos, para o filtro. */
  const tickers = useMemo(() => {
    const unicos = new Set<string>()
    for (const provento of proventos ?? []) {
      const ticker = provento.ticker.trim().toUpperCase()
      if (ticker) unicos.add(ticker)
    }
    return [...unicos].sort((a, b) => a.localeCompare(b))
  }, [proventos])

  const filtrados = useMemo(
    () =>
      filtroTicker
        ? sorted.filter((provento) => provento.ticker.trim().toUpperCase() === filtroTicker)
        : sorted,
    [sorted, filtroTicker],
  )

  const { page, pageItems, setPage } = usePagination(filtrados, PROVENTOS_PAGE_SIZE, filtroTicker)

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Coins className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Proventos</h1>
            <p className="text-sm text-slate-500">
              Dividendos, JCP e rendimentos recebidos da carteira.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={isLoading || !workspace}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setFormState({ mode: 'create' })}
            disabled={!workspace || formState.mode !== 'closed'}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Novo provento
          </button>
        </div>
      </header>

      {!workspace ? (
        <Alert variant="info" title="Nenhuma planilha configurada">
          Selecione ou crie uma planilha em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          antes de lançar proventos.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {formState.mode !== 'closed' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            {formState.mode === 'edit' ? 'Editar provento' : 'Novo provento'}
          </h2>
          <ProventoForm
            initial={formState.mode === 'edit' ? formState.provento : undefined}
            isSaving={isSaving}
            onSubmit={handleSubmit}
            onCancel={() => setFormState({ mode: 'closed' })}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && proventos === null ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando proventos…
          </p>
        ) : sorted.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhum provento lançado ainda. Clique em <strong>Novo provento</strong> para começar.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Filtrar por ticker
                <select
                  value={filtroTicker}
                  onChange={(event) => setFiltroTicker(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                >
                  <option value="">Todos os tickers</option>
                  {tickers.map((ticker) => (
                    <option key={ticker} value={ticker}>
                      {ticker}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500" aria-live="polite">
                {filtrados.length} de {sorted.length} lançamentos
              </p>
            </div>

            {filtrados.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">
                Nenhum provento para o ticker selecionado.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          Data Com
                        </th>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          Data Pagamento
                        </th>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          Categoria
                        </th>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          Ticker
                        </th>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          Tipo
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">
                          Valor Total
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((provento) => (
                        <tr key={provento.id} className="border-t border-slate-100">
                          <td className="px-4 py-2 tabular-nums text-slate-700">
                            {provento.dataCom ? formatarDataBR(provento.dataCom) : '—'}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-slate-700">
                            {formatarDataBR(provento.dataPagamento)}
                          </td>
                          <td className="px-4 py-2 text-slate-700">
                            {categoriaLabel(provento.categoria)}
                          </td>
                          <td className="px-4 py-2 font-mono font-medium text-slate-900">
                            {provento.ticker}
                          </td>
                          <td className="px-4 py-2 text-slate-700">{provento.tipo}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                            {formatarBRL(fromCentavos(provento.valorTotal))}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setFormState({ mode: 'edit', provento })}
                                disabled={formState.mode !== 'closed' || deletingId !== null}
                                aria-label={`Editar provento de ${provento.ticker}`}
                                className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(provento)}
                                disabled={formState.mode !== 'closed' || deletingId !== null}
                                aria-label={`Excluir provento de ${provento.ticker}`}
                                className="rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {deletingId === provento.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                ) : (
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={page}
                  pageSize={PROVENTOS_PAGE_SIZE}
                  total={filtrados.length}
                  onPageChange={setPage}
                />
              </>
            )}
          </>
        )}
      </div>

      {proventos && proventos.length > 0 ? <ExtratoProventos proventos={proventos} /> : null}
    </section>
  )
}
