import { Layers, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { EventoCorporativoForm } from '@/features/eventos/EventoCorporativoForm'
import { eventoToOperacao, toEventoPayload } from '@/features/eventos/eventoSchema'
import type { EventoFormOutput } from '@/features/eventos/eventoSchema'
import { categoriaLabel } from '@/lib/categoria'
import { calcularResumo } from '@/lib/consolidado'
import { formatarDataBR } from '@/lib/dates'
import {
  EVENTO_CORPORATIVO_LABELS,
  descreverEvento,
  eventosDeOperacoes,
} from '@/lib/eventosCorporativos'
import type { EventoCorporativo } from '@/lib/eventosCorporativos'
import { syncConsolidado } from '@/services/consolidado'
import { registrarSnapshot } from '@/services/historico'
import { consolidadoRepo, operacoesRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { describeSheetsError } from '@/services/sheets'

function byMostRecent(a: EventoCorporativo, b: EventoCorporativo): number {
  return b.data.localeCompare(a.data) || a.ticker.localeCompare(b.ticker)
}

/**
 * Registro de eventos corporativos (RF20, Seção 5.6): split, grupamento e
 * bonificação. Cada evento ajusta quantidade e preço médio **sem** gerar
 * lucro/prejuízo; a aba `Consolidado` é recalculada após cada escrita.
 */
export function EventosPage() {
  const { workspace, ensureAccessToken } = useAuth()
  const [eventos, setEventos] = useState<EventoCorporativo[] | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  const load = useCallback(
    async (forceRefresh = false) => {
      const context = await resolveContext()
      if (!context) return
      setIsLoading(true)
      setError(null)
      try {
        const operacoes = await operacoesRepo.list(context, { forceRefresh })
        setEventos(eventosDeOperacoes(operacoes))
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

  /** Recalcula o consolidado e registra um snapshot (best-effort). */
  async function sincronizarConsolidado(context: RepositoryContext) {
    try {
      const consolidado = await syncConsolidado(context)
      try {
        await registrarSnapshot(context, calcularResumo(consolidado))
      } catch {
        // Snapshot é best-effort — não bloqueia o evento já salvo.
      }
    } catch {
      consolidadoRepo.invalidateCache(context.spreadsheetId)
    }
  }

  async function handleSubmit(values: EventoFormOutput) {
    const context = await resolveContext()
    if (!context) return

    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      const evento = toEventoPayload(values)
      await operacoesRepo.append(context, eventoToOperacao(evento))
      const operacoes = await operacoesRepo.refresh(context)
      setEventos(eventosDeOperacoes(operacoes))
      await sincronizarConsolidado(context)
      setNotice(`${descreverEvento(evento)} de ${evento.ticker} registrado com sucesso.`)
      setIsFormOpen(false)
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(evento: EventoCorporativo) {
    const confirmed = window.confirm(
      `Excluir ${descreverEvento(evento)} de ${evento.ticker} em ${formatarDataBR(evento.data)}?`,
    )
    if (!confirmed) return

    const context = await resolveContext()
    if (!context) return

    setDeletingId(evento.id)
    setError(null)
    setNotice(null)
    try {
      await operacoesRepo.remove(context, evento.id)
      const operacoes = await operacoesRepo.refresh(context)
      setEventos(eventosDeOperacoes(operacoes))
      await sincronizarConsolidado(context)
      setNotice('Evento excluído com sucesso.')
    } catch (deleteError) {
      setError(describeSheetsError(deleteError))
    } finally {
      setDeletingId(null)
    }
  }

  const sorted = useMemo(() => (eventos ? [...eventos].sort(byMostRecent) : []), [eventos])

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Layers className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Eventos corporativos</h1>
            <p className="text-sm text-slate-500">
              Split, grupamento e bonificação — ajustam quantidade e preço médio.
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
            onClick={() => setIsFormOpen(true)}
            disabled={!workspace || isFormOpen}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Novo evento
          </button>
        </div>
      </header>

      {!workspace ? (
        <Alert variant="info" title="Nenhuma planilha configurada">
          Selecione ou crie uma planilha em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          antes de registrar eventos.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <Alert variant="info" title="Como funciona">
        Eventos corporativos <strong>não</strong> geram lucro/prejuízo: apenas dividem ou multiplicam
        a quantidade e ajustam o preço médio na proporção inversa, mantendo o total investido.
      </Alert>

      {isFormOpen ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Novo evento corporativo</h2>
          <EventoCorporativoForm
            isSaving={isSaving}
            onSubmit={handleSubmit}
            onCancel={() => setIsFormOpen(false)}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && eventos === null ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando eventos…
          </p>
        ) : sorted.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhum evento registrado. Clique em <strong>Novo evento</strong> para começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Eventos corporativos registrados</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Data</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Categoria</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Tipo</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Evento</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((evento) => (
                  <tr key={evento.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 tabular-nums text-slate-700">
                      {formatarDataBR(evento.data)}
                    </td>
                    <td className="px-4 py-2 font-mono font-medium text-slate-900">
                      {evento.ticker}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{categoriaLabel(evento.categoria)}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {EVENTO_CORPORATIVO_LABELS[evento.tipo]}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {descreverEvento(evento)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleDelete(evento)}
                          disabled={deletingId !== null}
                          aria-label={`Excluir ${descreverEvento(evento)} de ${evento.ticker}`}
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
    </section>
  )
}
