import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { ProventoForm } from '@/features/proventos/ProventoForm'
import { toProventoPayload } from '@/features/proventos/proventoSchema'
import type { ProventoFormOutput } from '@/features/proventos/proventoSchema'
import { categoriaLabel } from '@/lib/categoria'
import { formatarDataBR } from '@/lib/dates'
import { formatarBRL, fromCentavos } from '@/lib/money'
import { proventosRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { describeSheetsError } from '@/services/sheets'
import type { CategoriaAtivo, Provento } from '@/types/domain'
import { registrarSnapshotBestEffort } from './escritasAtivo'

/** Estado do formulário: fechado, novo lançamento ou edição de um provento. */
type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; provento: Provento }

function byMostRecent(a: Provento, b: Provento): number {
  return b.dataPagamento.localeCompare(a.dataPagamento) || a.id.localeCompare(b.id)
}

interface DetalheAtivoProventosProps {
  ticker: string
  categoria: CategoriaAtivo
  /** Proventos do dashboard (todas as abas) — filtrados pelo ticker. */
  proventos: readonly Provento[]
  /** Recarrega os dados do dashboard após uma escrita. */
  onChanged: () => Promise<void>
}

/**
 * Aba **Proventos** do modal do ativo: lista os dividendos/JCP/rendimentos do
 * ticker e permite registrar, editar e excluir proventos (RF05).
 */
export function DetalheAtivoProventos({
  ticker,
  categoria,
  proventos,
  onChanged,
}: DetalheAtivoProventosProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [formState, setFormState] = useState<FormState>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const doTicker = useMemo(
    () => proventos.filter((provento) => provento.ticker.trim().toUpperCase() === ticker).sort(byMostRecent),
    [proventos, ticker],
  )

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
      await registrarSnapshotBestEffort(context)
      setFormState({ mode: 'closed' })
      await onChanged()
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(provento: Provento) {
    const confirmed = window.confirm(
      `Excluir o provento pago em ${formatarDataBR(provento.dataPagamento)}?`,
    )
    if (!confirmed) return

    const context = await resolveContext()
    if (!context) return

    setDeletingId(provento.id)
    setError(null)
    setNotice(null)
    try {
      await proventosRepo.remove(context, provento.id)
      await registrarSnapshotBestEffort(context)
      setNotice('Provento excluído com sucesso.')
      await onChanged()
    } catch (deleteError) {
      setError(describeSheetsError(deleteError))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          Proventos de <span className="font-mono">{ticker}</span>
        </h3>
        <button
          type="button"
          onClick={() => setFormState({ mode: 'create' })}
          disabled={!workspace || formState.mode !== 'closed'}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Novo provento
        </button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {formState.mode !== 'closed' ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">
            {formState.mode === 'edit' ? 'Editar provento' : 'Novo provento'}
          </h4>
          <ProventoForm
            key={formState.mode === 'edit' ? formState.provento.id : 'novo'}
            initial={formState.mode === 'edit' ? formState.provento : undefined}
            tickerPadrao={ticker}
            categoriaPadrao={categoria}
            travarTicker
            isSaving={isSaving}
            onSubmit={handleSubmit}
            onCancel={() => {
              setFormState({ mode: 'closed' })
              setError(null)
            }}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        {doTicker.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhum provento registrado para este ativo. Clique em{' '}
            <strong>Novo provento</strong> para começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Proventos do ativo {ticker}</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Data Com</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Data Pagamento</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Categoria</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Tipo</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Valor Total</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {doTicker.map((provento) => (
                  <tr key={provento.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {provento.dataCom ? formatarDataBR(provento.dataCom) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {formatarDataBR(provento.dataPagamento)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{categoriaLabel(provento.categoria)}</td>
                    <td className="px-3 py-2 text-slate-700">{provento.tipo}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatarBRL(fromCentavos(provento.valorTotal))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setFormState({ mode: 'edit', provento })}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Editar provento de ${formatarDataBR(provento.dataPagamento)}`}
                          className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(provento)}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Excluir provento de ${formatarDataBR(provento.dataPagamento)}`}
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
        )}
      </div>
    </div>
  )
}
