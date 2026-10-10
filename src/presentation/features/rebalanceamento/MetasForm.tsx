import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { useState } from 'react'
import { FormField, inputClassName } from '@/components/FormField'
import { CATEGORIA_ATIVO_LABELS } from '@/lib/categoria'
import { cn } from '@/lib/cn'
import {
  CATEGORIAS_META,
  configDeDraft,
  draftDeConfig,
  somaMetasClasse,
} from '@/lib/rebalanceamento/draft'
import type { MetasDraft } from '@/lib/rebalanceamento/draft'
import type { ConfiguracaoMetas, MetasPorTicker } from '@/lib/rebalanceamento'
import { formatarPercentual } from '@/features/dashboard/formatters'
import type { CategoriaAtivo } from '@/types/domain'

interface MetasFormProps {
  /** Configuração atual (semente do rascunho editável). */
  config: ConfiguracaoMetas
  /** Notifica o pai a cada edição (config numérica). */
  onChange: (config: ConfiguracaoMetas) => void
  /** Metas efetivas normalizadas (`normalizarMetas`) por ticker. */
  metasEfetivas: MetasPorTicker
  /** Tickers com posição na carteira (para destacar linhas sem posição). */
  tickersNaCarteira: ReadonlySet<string>
  isSaving: boolean
  onSave: () => void
}

/**
 * Configuração de metas por classe e por ticker (RF12/RF13, Seção 5.7).
 *
 * A meta por classe é o nível base; a meta individual do ticker (override)
 * substitui a da classe. A coluna "Meta efetiva" mostra o resultado de
 * `normalizarMetas` (sempre somando 100%).
 */
export function MetasForm({
  config,
  onChange,
  metasEfetivas,
  tickersNaCarteira,
  isSaving,
  onSave,
}: MetasFormProps) {
  const [draft, setDraft] = useState<MetasDraft>(() => draftDeConfig(config))

  function aplicar(next: MetasDraft) {
    setDraft(next)
    onChange(configDeDraft(next))
  }

  function editarClasse(categoria: CategoriaAtivo, valor: string) {
    aplicar({ ...draft, metasClasse: { ...draft.metasClasse, [categoria]: valor } })
  }

  function editarItem(index: number, campo: 'nota' | 'metaIndividual' | 'precoTeto', valor: string) {
    const itens = draft.itens.map((item, posicao) =>
      posicao === index ? { ...item, [campo]: valor } : item,
    )
    aplicar({ ...draft, itens })
  }

  const totalClasse = somaMetasClasse(configDeDraft(draft))
  const classesDivergentes = Math.abs(totalClasse - 100) > 0.01

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Metas e notas</h2>
          <p className="text-sm text-slate-500">
            Defina a meta por classe e, se quiser, sobrescreva por ticker. As metas efetivas somam
            100%.
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Salvar metas
        </button>
      </header>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Meta por classe (%)</h3>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
              classesDivergentes ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700',
            )}
          >
            {classesDivergentes ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
            Soma: {formatarPercentual(totalClasse)}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIAS_META.map((categoria) => (
            <FormField
              key={categoria}
              htmlFor={`meta-classe-${categoria}`}
              label={CATEGORIA_ATIVO_LABELS[categoria]}
            >
              <input
                id={`meta-classe-${categoria}`}
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={draft.metasClasse[categoria] ?? ''}
                onChange={(event) => editarClasse(categoria, event.target.value)}
                className={inputClassName}
              />
            </FormField>
          ))}
        </div>
        {classesDivergentes ? (
          <p className="text-xs text-amber-700">
            As metas de classe não somam 100%. Isso é permitido — o app normaliza
            automaticamente — mas o ideal é que somem 100%.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Notas e overrides por ticker</h3>
        {draft.itens.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum ativo na carteira. Lance operações para configurar metas aqui.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Ticker</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Classe</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Nota (0–10)</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Meta individual (%)</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Preço teto (R$)</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Meta efetiva</th>
                </tr>
              </thead>
              <tbody>
                {draft.itens.map((item, index) => {
                  const semPosicao = !tickersNaCarteira.has(item.ticker)
                  return (
                    <tr key={item.ticker} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono font-medium text-slate-900">
                        {item.ticker}
                        {semPosicao ? (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            sem posição
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {CATEGORIA_ATIVO_LABELS[item.categoria]}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          aria-label={`Nota de ${item.ticker}`}
                          value={item.nota}
                          onChange={(event) => editarItem(index, 'nota', event.target.value)}
                          className={cn(inputClassName, 'w-20 px-2 py-1')}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Meta individual de ${item.ticker}`}
                          value={item.metaIndividual}
                          onChange={(event) =>
                            editarItem(index, 'metaIndividual', event.target.value)
                          }
                          className={cn(inputClassName, 'w-24 px-2 py-1')}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Preço teto de ${item.ticker}`}
                          value={item.precoTeto}
                          onChange={(event) => editarItem(index, 'precoTeto', event.target.value)}
                          className={cn(inputClassName, 'w-28 px-2 py-1')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-700">
                        {formatarPercentual(metasEfetivas[item.ticker] ?? 0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
