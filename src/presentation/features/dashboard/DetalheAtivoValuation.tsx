import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { FormField, inputClassName } from '@/components/FormField'
import { salvarValuation } from '@/application/valuation'
import { limiteDeCompra, oportunidadeDeCompra } from '@/domain/valuation'
import { formatarCentavos } from '@/features/dashboard/formatters'
import { parseBRL, parseDecimalBR, toCentavos } from '@/lib/money'
import { describeSheetsError } from '@/services/sheets'
import type { RepositoryContext } from '@/services/repositories'
import type { CategoriaAtivo, Valuation } from '@/types/domain'
import { valuationFormDefaults, valuationFormSchema, toValuationPayload } from './valuationSchema'
import type { ValuationFormInput, ValuationFormOutput } from './valuationSchema'

interface DetalheAtivoValuationProps {
  ticker: string
  categoria: CategoriaAtivo
  /** Análise já salva do ticker (`null` quando ainda não cadastrada). */
  valuation: Valuation | null
  /** Preço atual (cotação) em centavos — base da comparação de oportunidade. */
  precoAtual: number
  /** Recarrega os dados do dashboard após salvar. */
  onChanged: () => Promise<void>
}

/**
 * Aba **Informações de Valuation** do modal do ativo: cadastra o preço teto, a
 * margem de segurança e as anotações da tese, e mostra o limite de compra e o
 * estado de oportunidade (🎯) com base na cotação atual.
 */
export function DetalheAtivoValuation({
  ticker,
  categoria,
  valuation,
  precoAtual,
  onChanged,
}: DetalheAtivoValuationProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ValuationFormInput, unknown, ValuationFormOutput>({
    resolver: zodResolver(valuationFormSchema),
    defaultValues: valuationFormDefaults(valuation),
  })

  const precoTetoRaw = watch('precoTeto')
  const margemRaw = watch('margemSeguranca')

  /** Prévia do limite de compra e do estado de oportunidade (campos ao vivo). */
  const preview = useMemo(() => {
    const tetoReais = parseBRL(precoTetoRaw)
    const margem = parseDecimalBR(margemRaw)
    if (tetoReais === null || tetoReais <= 0 || margem === null || margem < 0) return null
    const teto = toCentavos(tetoReais)
    return {
      limite: limiteDeCompra(teto, margem),
      oportunidade: oportunidadeDeCompra(precoAtual, teto, margem),
    }
  }, [precoTetoRaw, margemRaw, precoAtual])

  /** Percentual da cotação atual em relação ao preço alvo (teto). */
  const percentualDoAlvo = useMemo(() => {
    const tetoReais = parseBRL(precoTetoRaw)
    if (tetoReais === null || tetoReais <= 0) return null
    const teto = toCentavos(tetoReais)
    return (precoAtual / teto) * 100
  }, [precoTetoRaw, precoAtual])

  async function handleSave(values: ValuationFormOutput) {
    if (!workspace) {
      setError('Configure uma planilha antes de salvar a análise.')
      return
    }
    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return
    }
    const context: RepositoryContext = {
      accessToken: token,
      spreadsheetId: workspace.spreadsheetId,
    }

    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      await salvarValuation(context, toValuationPayload(values, ticker, categoria))
      setNotice('Análise de valuation salva com sucesso.')
      await onChanged()
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Defina o <strong>preço teto</strong> (valor justo) e a{' '}
        <strong>margem de segurança</strong> desejada. O dashboard mostra um alerta{' '}
        <span aria-hidden>🎯</span> quando a cotação atual ficar igual ou abaixo do limite de
        compra: <em>teto − (teto × margem ÷ 100)</em>.
      </p>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Cotação atual</p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tabular-nums text-slate-900">
          <span>{formatarCentavos(precoAtual)}</span>
          {percentualDoAlvo !== null ? (
            <span className="text-sm font-medium text-slate-500">
              {percentualDoAlvo.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do alvo
            </span>
          ) : null}
        </p>
        {preview ? (
          <p className="mt-1 text-sm text-slate-700">
            Limite de compra:{' '}
            <span className="font-semibold tabular-nums">{formatarCentavos(preview.limite)}</span>
            {' · '}
            {preview.oportunidade ? (
              <span className="font-semibold text-emerald-700">
                🎯 Oportunidade de compra atingida
              </span>
            ) : (
              <span className="font-semibold text-slate-600">Ainda fora do alvo</span>
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Informe o preço teto e a margem para calcular o limite de compra.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit(handleSave)} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="valuation-preco-teto"
            label="Preço Teto (ou Valor Justo)"
            hint="Preço máximo estipulado para o ativo (em reais)."
            error={errors.precoTeto?.message}
          >
            <input
              id="valuation-preco-teto"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              className={inputClassName}
              {...register('precoTeto')}
            />
          </FormField>

          <FormField
            htmlFor="valuation-margem"
            label="Margem de Segurança (%)"
            hint="Ex.: 20 para 20% de desconto sobre o preço teto."
            error={errors.margemSeguranca?.message}
          >
            <input
              id="valuation-margem"
              type="text"
              inputMode="decimal"
              placeholder="Ex.: 20"
              className={inputClassName}
              {...register('margemSeguranca')}
            />
          </FormField>
        </div>

        <FormField
          htmlFor="valuation-anotacoes"
          label="Anotações da Análise"
          hint="Observações livres sobre a tese de investimento. Deixe os campos vazios e salve para remover a análise."
          error={errors.anotacoes?.message}
        >
          <textarea
            id="valuation-anotacoes"
            rows={4}
            placeholder="Ex.: empresa com vantagem competitiva durável…"
            className={inputClassName}
            {...register('anotacoes')}
          />
        </FormField>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Salvar análise
          </button>
        </div>
      </form>
    </div>
  )
}
