import { ArrowLeftRight, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { OperacaoForm } from '@/features/operacoes/OperacaoForm'
import { toOperacaoPayload } from '@/features/operacoes/operacaoSchema'
import type { OperacaoFormOutput } from '@/features/operacoes/operacaoSchema'
import { categoriaLabel } from '@/lib/categoria'
import { calcularResumo } from '@/lib/consolidado'
import { formatarDataBR } from '@/lib/dates'
import { isTipoEventoCorporativo } from '@/lib/eventosCorporativos'
import { formatarBRL, fromCentavos } from '@/lib/money'
import { syncConsolidado } from '@/services/consolidado'
import { registrarSnapshot } from '@/services/historico'
import { consolidadoRepo, operacoesRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { describeSheetsError } from '@/services/sheets'
import type { Operacao } from '@/types/domain'
import { OperacaoTipo } from '@/types/domain'

/** Estado do formulário: fechado, novo lançamento ou edição de uma operação. */
type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; operacao: Operacao }

function byMostRecent(a: Operacao, b: Operacao): number {
  return b.data.localeCompare(a.data) || a.ticker.localeCompare(b.ticker)
}

/**
 * CRUD de operações (compras/vendas) — RF04/RF06.
 *
 * Após cada escrita o cache da aba é invalidado e a lista é relida da API,
 * garantindo que o lançamento apareça imediatamente, sem duplicidade (ID
 * único por linha). O cache do `Consolidado` também é invalidado para que o
 * recálculo da carteira (Etapa 4) reflita o lançamento.
 */
export function OperacoesPage() {
  const { workspace, ensureAccessToken } = useAuth()
  const [operacoes, setOperacoes] = useState<Operacao[] | null>(null)
  const [formState, setFormState] = useState<FormState>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure uma planilha antes de lançar operações.')
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
        setOperacoes(await operacoesRepo.list(context, { forceRefresh }))
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
   * Recalcula e materializa a aba `Consolidado` (Seção 5.1) a partir das
   * operações atuais e registra um snapshot no `Historico` (Seção 2). Em caso
   * de falha, apenas invalida o cache para o próximo acesso recalcular — sem
   * impedir o lançamento já salvo (RNF04).
   */
  async function sincronizarConsolidado(context: RepositoryContext) {
    try {
      const consolidado = await syncConsolidado(context)
      try {
        await registrarSnapshot(context, calcularResumo(consolidado))
      } catch {
        // Snapshot é best-effort — não bloqueia a operação já salva.
      }
    } catch {
      consolidadoRepo.invalidateCache(context.spreadsheetId)
    }
  }

  async function handleSubmit(values: OperacaoFormOutput) {
    const context = await resolveContext()
    if (!context || formState.mode === 'closed') return

    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (formState.mode === 'create') {
        await operacoesRepo.append(context, {
          id: operacoesRepo.newId(),
          ...toOperacaoPayload(values),
        })
        setNotice('Operação registrada com sucesso.')
      } else {
        await operacoesRepo.update(context, {
          ...toOperacaoPayload(values),
          id: formState.operacao.id,
        })
        setNotice('Operação atualizada com sucesso.')
      }
      setOperacoes(await operacoesRepo.refresh(context))
      await sincronizarConsolidado(context)
      setFormState({ mode: 'closed' })
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(operacao: Operacao) {
    const confirmed = window.confirm(
      `Excluir a operação de ${operacao.tipo.toLowerCase()} de ${operacao.ticker} em ${formatarDataBR(operacao.data)}?`,
    )
    if (!confirmed) return

    const context = await resolveContext()
    if (!context) return

    setDeletingId(operacao.id)
    setError(null)
    setNotice(null)
    try {
      await operacoesRepo.remove(context, operacao.id)
      setOperacoes(await operacoesRepo.refresh(context))
      await sincronizarConsolidado(context)
      setNotice('Operação excluída com sucesso.')
    } catch (deleteError) {
      setError(describeSheetsError(deleteError))
    } finally {
      setDeletingId(null)
    }
  }

  const sorted = operacoes
    ? [...operacoes].filter((operacao) => !isTipoEventoCorporativo(operacao.tipo)).sort(byMostRecent)
    : []

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <ArrowLeftRight className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Operações</h1>
            <p className="text-sm text-slate-500">
              Lançamentos de compra e venda de ativos da carteira.
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
            Nova operação
          </button>
        </div>
      </header>

      {!workspace ? (
        <Alert variant="info" title="Nenhuma planilha configurada">
          Selecione ou crie uma planilha em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          antes de lançar operações.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {formState.mode !== 'closed' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            {formState.mode === 'edit' ? 'Editar operação' : 'Nova operação'}
          </h2>
          <OperacaoForm
            initial={formState.mode === 'edit' ? formState.operacao : undefined}
            isSaving={isSaving}
            onSubmit={handleSubmit}
            onCancel={() => setFormState({ mode: 'closed' })}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && operacoes === null ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando operações…
          </p>
        ) : sorted.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhuma operação lançada ainda. Clique em <strong>Nova operação</strong> para começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Data</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Tipo</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Categoria</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Quantidade</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Preço Unitário</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Taxas</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((operacao) => (
                  <tr key={operacao.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 tabular-nums text-slate-700">
                      {formatarDataBR(operacao.data)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          operacao.tipo === OperacaoTipo.Compra
                            ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                            : 'inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700'
                        }
                      >
                        {operacao.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{categoriaLabel(operacao.categoria)}</td>
                    <td className="px-4 py-2 font-mono font-medium text-slate-900">
                      {operacao.ticker}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {operacao.quantidade.toLocaleString('pt-BR', {
                        maximumFractionDigits: 8,
                      })}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {formatarBRL(fromCentavos(operacao.precoUnitario))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {formatarBRL(fromCentavos(operacao.taxas))}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setFormState({ mode: 'edit', operacao })}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Editar operação de ${operacao.ticker}`}
                          className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(operacao)}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Excluir operação de ${operacao.ticker}`}
                          className="rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {deletingId === operacao.id ? (
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
