import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { FormField, inputClassName } from '@/components/FormField'
import { CATEGORIA_ATIVO_LABELS } from '@/lib/categoria'
import {
  EVENTO_CORPORATIVO_LABELS,
  EVENTO_CORPORATIVO_VALOR_LABELS,
} from '@/lib/eventosCorporativos'
import { toISO } from '@/lib/dates'
import { CategoriaAtivo, EVENTO_CORPORATIVO_TIPOS, OperacaoTipo } from '@/types/domain'
import { eventoFormDefaults, eventoFormSchema } from '@/features/eventos/eventoSchema'
import type { EventoFormInput, EventoFormOutput } from '@/features/eventos/eventoSchema'

interface EventoCorporativoFormProps {
  isSaving: boolean
  onSubmit: (values: EventoFormOutput) => Promise<void>
  onCancel: () => void
}

/** Dica (pt-BR) por tipo de evento, explicando o efeito em quantidade/preço médio. */
const EVENTO_HINTS: Record<(typeof EVENTO_CORPORATIVO_TIPOS)[number], string> = {
  [OperacaoTipo.Split]: 'Split 1:N — a quantidade é multiplicada por N e o preço médio dividido por N.',
  [OperacaoTipo.Grupamento]: 'Grupamento N:1 — a quantidade é dividida por N e o preço médio multiplicado por N.',
  [OperacaoTipo.Bonificacao]: 'Bonificação x% — a quantidade aumenta em x% e o preço médio cai proporcionalmente.',
}

/**
 * Formulário de evento corporativo (RF20, Seção 5.6): split, grupamento e
 * bonificação. O evento ajusta quantidade e preço médio sem gerar lucro/prejuízo.
 */
export function EventoCorporativoForm({ isSaving, onSubmit, onCancel }: EventoCorporativoFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<EventoFormInput, unknown, EventoFormOutput>({
    resolver: zodResolver(eventoFormSchema),
    defaultValues: eventoFormDefaults(toISO(new Date())),
  })

  const tipo = watch('tipo')

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField htmlFor="evento-data" label="Data" error={errors.data?.message}>
          <input id="evento-data" type="date" className={inputClassName} {...register('data')} />
        </FormField>

        <FormField htmlFor="evento-ticker" label="Ticker" error={errors.ticker?.message}>
          <input
            id="evento-ticker"
            type="text"
            placeholder="Ex.: PETR4"
            autoComplete="off"
            className={inputClassName}
            {...register('ticker')}
          />
        </FormField>

        <FormField htmlFor="evento-categoria" label="Categoria" error={errors.categoria?.message}>
          <select id="evento-categoria" className={inputClassName} {...register('categoria')}>
            {Object.values(CategoriaAtivo).map((value) => (
              <option key={value} value={value}>
                {CATEGORIA_ATIVO_LABELS[value]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField htmlFor="evento-tipo" label="Tipo de evento" error={errors.tipo?.message}>
          <select id="evento-tipo" className={inputClassName} {...register('tipo')}>
            {EVENTO_CORPORATIVO_TIPOS.map((value) => (
              <option key={value} value={value}>
                {EVENTO_CORPORATIVO_LABELS[value]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          htmlFor="evento-valor"
          label={EVENTO_CORPORATIVO_VALOR_LABELS[tipo]}
          hint={EVENTO_HINTS[tipo]}
          error={errors.valor?.message}
        >
          <input
            id="evento-valor"
            type="text"
            inputMode="decimal"
            placeholder={tipo === OperacaoTipo.Bonificacao ? 'Ex.: 10 (10%)' : 'Ex.: 2'}
            className={inputClassName}
            {...register('valor')}
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
          Registrar evento
        </button>
      </div>
    </form>
  )
}
