import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { FormField, inputClassName } from '@/components/FormField'
import { CATEGORIA_ATIVO_LABELS, isRendaFixa } from '@/lib/categoria'
import type { Operacao } from '@/types/domain'
import { CategoriaAtivo, IndexadorRendaFixa, OPERACAO_MOVIMENTO_TIPOS, OperacaoTipo } from '@/types/domain'
import {
  operacaoFormDefaults,
  operacaoFormSchema,
} from '@/features/operacoes/operacaoSchema'
import type { OperacaoFormInput, OperacaoFormOutput } from '@/features/operacoes/operacaoSchema'

interface OperacaoFormProps {
  /** Operação em edição (`undefined` = novo lançamento). */
  initial?: Operacao
  /** Ticker pré-preenchido em novos lançamentos (ex.: cadastro a partir do ativo). */
  tickerPadrao?: string
  /** Categoria pré-selecionada em novos lançamentos. */
  categoriaPadrao?: CategoriaAtivo
  /** Trava o campo Ticker (cadastro vinculado a um ativo específico). */
  travarTicker?: boolean
  isSaving: boolean
  onSubmit: (values: OperacaoFormOutput) => Promise<void>
  onCancel: () => void
}

const OPERACAO_TIPO_LABELS: Record<OperacaoTipo, string> = {
  [OperacaoTipo.Compra]: 'Compra',
  [OperacaoTipo.Venda]: 'Venda',
  [OperacaoTipo.Split]: 'Desdobramento (split)',
  [OperacaoTipo.Grupamento]: 'Grupamento',
  [OperacaoTipo.Bonificacao]: 'Bonificação',
}

const INDEXADOR_OPTIONS = [
  IndexadorRendaFixa.Cdi,
  IndexadorRendaFixa.Ipca,
  IndexadorRendaFixa.Prefixado,
] as const

/**
 * Formulário de operação (compra/venda) com `react-hook-form` + `zod` (RF04).
 *
 * Os campos de Renda Fixa (`Indexador`, `% do Indexador`, `Vencimento`,
 * `Valor Bruto Atual`) aparecem apenas quando a categoria é `RendaFixa`.
 */
export function OperacaoForm({
  initial,
  tickerPadrao,
  categoriaPadrao,
  travarTicker = false,
  isSaving,
  onSubmit,
  onCancel,
}: OperacaoFormProps) {
  const padroes = operacaoFormDefaults(initial)
  const valoresIniciais: OperacaoFormInput = initial
    ? padroes
    : {
        ...padroes,
        ticker: tickerPadrao ?? padroes.ticker,
        categoria: categoriaPadrao ?? padroes.categoria,
      }

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<OperacaoFormInput, unknown, OperacaoFormOutput>({
    resolver: zodResolver(operacaoFormSchema),
    defaultValues: valoresIniciais,
  })

  const categoria = watch('categoria')
  const showRendaFixa = isRendaFixa(categoria)

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField htmlFor="operacao-data" label="Data" error={errors.data?.message}>
          <input id="operacao-data" type="date" className={inputClassName} {...register('data')} />
        </FormField>

        <FormField htmlFor="operacao-tipo" label="Tipo" error={errors.tipo?.message}>
          <select id="operacao-tipo" className={inputClassName} {...register('tipo')}>
            {OPERACAO_MOVIMENTO_TIPOS.map((tipo) => (
              <option key={tipo} value={tipo}>
                {OPERACAO_TIPO_LABELS[tipo]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField htmlFor="operacao-categoria" label="Categoria" error={errors.categoria?.message}>
          <select id="operacao-categoria" className={inputClassName} {...register('categoria')}>
            {Object.values(CategoriaAtivo).map((value) => (
              <option key={value} value={value}>
                {CATEGORIA_ATIVO_LABELS[value]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField htmlFor="operacao-ticker" label="Ticker" error={errors.ticker?.message}>
          <input
            id="operacao-ticker"
            type="text"
            placeholder="Ex.: PETR4"
            autoComplete="off"
            disabled={travarTicker}
            className={inputClassName}
            {...register('ticker')}
          />
        </FormField>

        <FormField
          htmlFor="operacao-quantidade"
          label="Quantidade"
          error={errors.quantidade?.message}
        >
          <input
            id="operacao-quantidade"
            type="text"
            inputMode="decimal"
            placeholder="Ex.: 100"
            className={inputClassName}
            {...register('quantidade')}
          />
        </FormField>

        <FormField
          htmlFor="operacao-preco"
          label="Preço Unitário (R$)"
          error={errors.precoUnitario?.message}
        >
          <input
            id="operacao-preco"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            className={inputClassName}
            {...register('precoUnitario')}
          />
        </FormField>

        <FormField
          htmlFor="operacao-taxas"
          label="Taxas (R$)"
          hint="Opcional — somadas ao custo da operação."
          error={errors.taxas?.message}
        >
          <input
            id="operacao-taxas"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            className={inputClassName}
            {...register('taxas')}
          />
        </FormField>
      </div>

      {showRendaFixa ? (
        <fieldset className="space-y-4 rounded-lg border border-brand-100 bg-brand-50/40 p-4">
          <legend className="px-1 text-sm font-semibold text-brand-700">
            Renda Fixa
          </legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField
              htmlFor="operacao-indexador"
              label="Indexador"
              error={errors.indexador?.message}
            >
              <select id="operacao-indexador" className={inputClassName} {...register('indexador')}>
                <option value="">Selecione…</option>
                {INDEXADOR_OPTIONS.map((indexador) => (
                  <option key={indexador} value={indexador}>
                    {indexador}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              htmlFor="operacao-percentual-indexador"
              label="% do Indexador"
              hint="Ex.: 110 para 110% do CDI."
              error={errors.percentualIndexador?.message}
            >
              <input
                id="operacao-percentual-indexador"
                type="text"
                inputMode="decimal"
                placeholder="Ex.: 110"
                className={inputClassName}
                {...register('percentualIndexador')}
              />
            </FormField>

            <FormField
              htmlFor="operacao-vencimento"
              label="Vencimento"
              error={errors.vencimento?.message}
            >
              <input
                id="operacao-vencimento"
                type="date"
                className={inputClassName}
                {...register('vencimento')}
              />
            </FormField>

            <FormField
              htmlFor="operacao-valor-bruto"
              label="Valor Bruto Atual (R$)"
              hint="Opcional — marcação a mercado editável."
              error={errors.valorBrutoAtual?.message}
            >
              <input
                id="operacao-valor-bruto"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                className={inputClassName}
                {...register('valorBrutoAtual')}
              />
            </FormField>
          </div>
        </fieldset>
      ) : null}

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
          {initial ? 'Salvar alterações' : 'Registrar operação'}
        </button>
      </div>
    </form>
  )
}
