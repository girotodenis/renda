import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { Pagination } from '@/presentation/components/Pagination'
import { PAGE_SIZE, usePagination } from '@/presentation/hooks/usePagination'
import { OperacaoForm } from '@/presentation/features/operacoes/OperacaoForm'
import { toOperacaoPayload } from '@/presentation/features/operacoes/operacaoSchema'
import type { OperacaoFormOutput } from '@/presentation/features/operacoes/operacaoSchema'
import { categoriaLabel } from '@/domain/categoria'
import { formatarDataBR } from '@/domain/dates'
import { isTipoEventoCorporativo } from '@/domain/eventosCorporativos'
import { formatarBRL, fromCentavos } from '@/domain/money'
import { operacoesRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import type { CategoriaAtivo, Operacao } from '@/domain/entities'
import { OperacaoTipo } from '@/domain/entities'
import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'

/** Estado do formulário: fechado, novo lançamento ou edição de uma operação. */
type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; operacao: Operacao }

function byMostRecent(a: Operacao, b: Operacao): number {
  return b.data.localeCompare(a.data) || b.id.localeCompare(a.id)
}

interface DetalheAtivoOperacoesProps {
  ticker: string
  categoria: CategoriaAtivo
  /** Operações do dashboard (todas as abas) — filtradas pelo ticker. */
  operacoes: readonly Operacao[]
  /** Recarrega os dados do dashboard após uma escrita. */
  onChanged: () => Promise<void>
}

/**
 * Aba **Operações** do modal do ativo: lista as compras/vendas do ticker e
 * permite registrar, editar e excluir operações sem sair do dashboard (RF04).
 * Os eventos corporativos são exibidos na aba própria (Eventos).
 */
export function DetalheAtivoOperacoes({
  ticker,
  categoria,
  operacoes,
  onChanged,
}: DetalheAtivoOperacoesProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [formState, setFormState] = useState<FormState>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const doTicker = useMemo(
    () =>
      operacoes
        .filter(
          (operacao) =>
            operacao.ticker.trim().toUpperCase() === ticker &&
            !isTipoEventoCorporativo(operacao.tipo),
        )
        .sort(byMostRecent),
    [operacoes, ticker],
  )

  const { page, pageItems, setPage } = usePagination(doTicker, PAGE_SIZE, ticker)

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
      await sincronizarConsolidadoESnapshot(context)
      setFormState({ mode: 'closed' })
      await onChanged()
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(operacao: Operacao) {
    const confirmed = window.confirm(
      `Excluir a operação de ${operacao.tipo.toLowerCase()} em ${formatarDataBR(operacao.data)}?`,
    )
    if (!confirmed) return

    const context = await resolveContext()
    if (!context) return

    setDeletingId(operacao.id)
    setError(null)
    setNotice(null)
    try {
      await operacoesRepo.remove(context, operacao.id)
      await sincronizarConsolidadoESnapshot(context)
      setNotice('Operação excluída com sucesso.')
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
          Operações de <span className="font-mono">{ticker}</span>
        </h3>
        <button
          type="button"
          onClick={() => setFormState({ mode: 'create' })}
          disabled={!workspace || formState.mode !== 'closed'}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nova operação
        </button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {formState.mode !== 'closed' ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">
            {formState.mode === 'edit' ? 'Editar operação' : 'Nova operação'}
          </h4>
          <OperacaoForm
            key={formState.mode === 'edit' ? formState.operacao.id : 'novo'}
            initial={formState.mode === 'edit' ? formState.operacao : undefined}
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
            Nenhuma operação registrada para este ativo. Clique em{' '}
            <strong>Nova operação</strong> para começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Operações do ativo {ticker}</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Data</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Tipo</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Categoria</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Quantidade</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Preço Unitário</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Taxas</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((operacao) => (
                  <tr key={operacao.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {formatarDataBR(operacao.data)}
                    </td>
                    <td className="px-3 py-2">
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
                    <td className="px-3 py-2 text-slate-700">
                      {categoriaLabel(operacao.categoria)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {operacao.quantidade.toLocaleString('pt-BR', {
                        maximumFractionDigits: 8,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatarBRL(fromCentavos(operacao.precoUnitario))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatarBRL(fromCentavos(operacao.taxas))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setFormState({ mode: 'edit', operacao })}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Editar operação de ${formatarDataBR(operacao.data)}`}
                          className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(operacao)}
                          disabled={formState.mode !== 'closed' || deletingId !== null}
                          aria-label={`Excluir operação de ${formatarDataBR(operacao.data)}`}
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
        {doTicker.length > 0 ? (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={doTicker.length}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </div>
  )
}
