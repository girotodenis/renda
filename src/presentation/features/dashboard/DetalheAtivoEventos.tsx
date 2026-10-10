import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { EventoCorporativoForm } from '@/features/eventos/EventoCorporativoForm'
import { eventoToOperacao, toEventoPayload } from '@/features/eventos/eventoSchema'
import type { EventoFormOutput } from '@/features/eventos/eventoSchema'
import { categoriaLabel } from '@/lib/categoria'
import { formatarDataBR } from '@/lib/dates'
import {
  EVENTO_CORPORATIVO_LABELS,
  descreverEvento,
  eventosDeOperacoes,
} from '@/lib/eventosCorporativos'
import type { EventoCorporativo } from '@/lib/eventosCorporativos'
import { operacoesRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { describeSheetsError } from '@/services/sheets'
import type { CategoriaAtivo, Operacao } from '@/types/domain'
import { sincronizarConsolidadoESnapshot } from './escritasAtivo'

/** Estado do formulário: fechado, novo lançamento ou edição de um evento. */
type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; evento: EventoCorporativo }

function byMostRecent(a: EventoCorporativo, b: EventoCorporativo): number {
  return b.data.localeCompare(a.data) || a.id.localeCompare(b.id)
}

interface DetalheAtivoEventosProps {
  ticker: string
  categoria: CategoriaAtivo
  /** Operações do dashboard (inclui os eventos corporativos) — filtradas pelo ticker. */
  operacoes: readonly Operacao[]
  /** Recarrega os dados do dashboard após uma escrita. */
  onChanged: () => Promise<void>
}

/**
 * Aba **Eventos** do modal do ativo: lista split/grupamento/bonificação do
 * ticker (RF20, Seção 5.6) e permite registrar, editar e excluir eventos.
 *
 * Cada evento é persistido como uma linha da aba `Operacoes`; a edição preserva
 * o `id` da linha original.
 */
export function DetalheAtivoEventos({
  ticker,
  categoria,
  operacoes,
  onChanged,
}: DetalheAtivoEventosProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [formState, setFormState] = useState<FormState>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const doTicker = useMemo(
    () =>
      eventosDeOperacoes(operacoes)
        .filter((evento) => evento.ticker.trim().toUpperCase() === ticker)
        .sort(byMostRecent),
    [operacoes, ticker],
  )

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure uma planilha antes de registrar eventos.')
      return null
    }
    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return null
    }
    return { accessToken: token, spreadsheetId: workspace.spreadsheetId }
  }, [workspace, ensureAccessToken])

  async function handleSubmit(values: EventoFormOutput) {
    const context = await resolveContext()
    if (!context || formState.mode === 'closed') return

    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      const evento = toEventoPayload(values)
      if (formState.mode === 'create') {
        await operacoesRepo.append(context, eventoToOperacao(evento))
        setNotice(`${descreverEvento(evento)} registrado com sucesso.`)
      } else {
        await operacoesRepo.update(context, {
          ...eventoToOperacao(evento),
          id: formState.evento.id,
        })
        setNotice(`${descreverEvento(evento)} atualizado com sucesso.`)
      }
      await sincronizarConsolidadoESnapshot(context)
      setFormState({ mode: 'closed' })
      await onChanged()
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(evento: EventoCorporativo) {
    const confirmed = window.confirm(
      `Excluir ${descreverEvento(evento)} em ${formatarDataBR(evento.data)}?`,
    )
    if (!confirmed) return

    const context = await resolveContext()
    if (!context) return

    setDeletingId(evento.id)
    setError(null)
    setNotice(null)
    try {
      await operacoesRepo.remove(context, evento.id)
      await sincronizarConsolidadoESnapshot(context)
      setNotice('Evento excluído com sucesso.')
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
          Eventos de <span className="font-mono">{ticker}</span>
        </h3>
        <button
          type="button"
          onClick={() => setFormState({ mode: 'create' })}
          disabled={!workspace || formState.mode !== 'closed'}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Novo evento
        </button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {formState.mode !== 'closed' ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">
            {formState.mode === 'edit' ? 'Editar evento' : 'Novo evento corporativo'}
          </h4>
          <EventoCorporativoForm
            key={formState.mode === 'edit' ? formState.evento.id : 'novo'}
            initial={formState.mode === 'edit' ? formState.evento : undefined}
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
            Nenhum evento registrado para este ativo. Clique em <strong>Novo evento</strong> para
            começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Eventos corporativos do ativo {ticker}</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Data</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Categoria</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Tipo</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Evento</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {doTicker.map((evento) => (
                  <tr key={evento.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {formatarDataBR(evento.data)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{categoriaLabel(evento.categoria)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {EVENTO_CORPORATIVO_LABELS[evento.tipo]}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {descreverEvento(evento)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setFormState({ mode: 'edit', evento })}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Editar ${descreverEvento(evento)}`}
                          className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(evento)}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Excluir ${descreverEvento(evento)}`}
                          className="rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {deletingId === evento.id ? (
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
