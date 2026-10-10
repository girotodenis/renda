import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { FormField, inputClassName } from '@/components/FormField'
import { CATEGORIA_ATIVO_LABELS } from '@/lib/categoria'
import type { Provento } from '@/types/domain'
import { CategoriaAtivo, ProventoTipo } from '@/types/domain'
import { proventoFormDefaults, proventoFormSchema } from '@/features/proventos/proventoSchema'
import type { ProventoFormInput, ProventoFormOutput } from '@/features/proventos/proventoSchema'

interface ProventoFormProps {
  /** Provento em edição (`undefined` = novo lançamento). */
  initial?: Provento
  isSaving: boolean
  onSubmit: (values: ProventoFormOutput) => Promise<void>
  onCancel: () => void
}

const PROVENTO_TIPO_LABELS: Record<ProventoTipo, string> = {
  [ProventoTipo.Dividendo]: 'Dividendo',
  [ProventoTipo.Jcp]: 'JCP',
  [ProventoTipo.Rendimento]: 'Rendimento',
}

/**
 * Formulário de provento (dividendo/JCP/rendimento) com `react-hook-form` +
 * `zod` (RF05).
 */
export function ProventoForm({ initial, isSaving, onSubmit, onCancel }: ProventoFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProventoFormInput, unknown, ProventoFormOutput>({
    resolver: zodResolver(proventoFormSchema),
    defaultValues: proventoFormDefaults(initial),
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField
          htmlFor="provento-data-com"
          label="Data Com"
          hint="Opcional — última data com direito ao provento."
          error={errors.dataCom?.message}
        >
          <input
            id="provento-data-com"
            type="date"
            className={inputClassName}
            {...register('dataCom')}
          />
        </FormField>

        <FormField
          htmlFor="provento-data-pagamento"
          label="Data Pagamento"
          error={errors.dataPagamento?.message}
        >
          <input
            id="provento-data-pagamento"
            type="date"
            className={inputClassName}
            {...register('dataPagamento')}
          />
        </FormField>

        <FormField htmlFor="provento-categoria" label="Categoria" error={errors.categoria?.message}>
          <select id="provento-categoria" className={inputClassName} {...register('categoria')}>
            {Object.values(CategoriaAtivo).map((value) => (
              <option key={value} value={value}>
                {CATEGORIA_ATIVO_LABELS[value]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField htmlFor="provento-ticker" label="Ticker" error={errors.ticker?.message}>
          <input
            id="provento-ticker"
            type="text"
            placeholder="Ex.: PETR4"
            autoComplete="off"
            className={inputClassName}
            {...register('ticker')}
          />
        </FormField>

        <FormField htmlFor="provento-tipo" label="Tipo" error={errors.tipo?.message}>
          <select id="provento-tipo" className={inputClassName} {...register('tipo')}>
            {Object.values(ProventoTipo).map((tipo) => (
              <option key={tipo} value={tipo}>
                {PROVENTO_TIPO_LABELS[tipo]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          htmlFor="provento-valor-total"
          label="Valor Total (R$)"
          error={errors.valorTotal?.message}
        >
          <input
            id="provento-valor-total"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            className={inputClassName}
            {...register('valorTotal')}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {initial ? 'Salvar alterações' : 'Registrar provento'}
        </button>
      </div>
    </form>
  )
}
