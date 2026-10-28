import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Accordion } from '@/presentation/components/Accordion'
import { Alert } from '@/presentation/components/Alert'
import { FormField, inputClassName } from '@/presentation/components/FormField'
import { salvarValuation } from '@/application/valuation'
import { calcularFluxoDescontado } from '@/domain/dcf'
import type { DcfResult } from '@/domain/dcf'
import { calcularPrecoGraham } from '@/domain/graham'
import { limiteDeCompra, oportunidadeDeCompra } from '@/domain/valuation'
import { formatarCentavos } from '@/presentation/features/dashboard/formatters'
import { formatMoneyInput, parseBRL, parseDecimalBR, toCentavos } from '@/domain/money'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import type { RepositoryContext } from '@/infrastructure/repositories'
import type { CategoriaAtivo, Valuation } from '@/domain/entities'
import {
  dcfFormSchema,
  grahamFormSchema,
  valuationFormDefaults,
  valuationFormSchema,
  toValuationPayload,
} from './valuationSchema'
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
  const [dcfError, setDcfError] = useState<string | null>(null)
  const [dcfResult, setDcfResult] = useState<DcfResult | null>(null)
  const [grahamError, setGrahamError] = useState<string | null>(null)
  const [grahamResult, setGrahamResult] = useState<number | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<ValuationFormInput, unknown, ValuationFormOutput>({
    resolver: zodResolver(valuationFormSchema),
    defaultValues: valuationFormDefaults(valuation),
  })

  const precoTetoRaw = watch('precoTeto') ?? ''
  const margemRaw = watch('margemSeguranca') ?? ''

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

  /**
   * Calcula o preço justo pelo FCD e preenche o campo **Preço Teto** com o
   * resultado. As premissas são lidas dos campos do próprio formulário.
   */
  function handleCalcularDcf() {
    setDcfError(null)
    const parsed = dcfFormSchema.safeParse({
      fclAtual: getValues('fclAtual'),
      dividaLiquida: getValues('dividaLiquida'),
      acoesMilhoes: getValues('acoesMilhoes'),
      crescimentoAno: getValues('crescimentoAno'),
      taxaDesconto: getValues('taxaDesconto'),
      anosProjecao: getValues('anosProjecao'),
      crescimentoPerpetuidade: getValues('crescimentoPerpetuidade'),
    })

    if (!parsed.success) {
      setDcfError(parsed.error.issues[0]?.message ?? 'Revise as premissas do FCD.')
      setDcfResult(null)
      return
    }

    const resultado = calcularFluxoDescontado(parsed.data)
    if (resultado === null) {
      setDcfError(
        'A taxa de desconto deve ser maior que o crescimento na perpetuidade e o fluxo de caixa deve ser positivo.',
      )
      setDcfResult(null)
      return
    }

    if (resultado.precoJusto <= 0) {
      setDcfResult(resultado)
      setDcfError(
        'O FCD resultou em valor negativo por ação. Revise as premissas (a dívida líquida pode estar alta demais).',
      )
      return
    }

    setDcfResult(resultado)
    setValue('precoTeto', formatMoneyInput(resultado.precoJusto), { shouldValidate: true })
  }

  /**
   * Calcula o Preço Justo de Graham e preenche o campo **Preço Teto** com o
   * resultado. As premissas (LPA e VPA) são lidas dos campos do formulário.
   */
  function handleCalcularGraham() {
    setGrahamError(null)
    const parsed = grahamFormSchema.safeParse({
      lpa: getValues('lpa'),
      vpa: getValues('vpa'),
    })

    if (!parsed.success) {
      setGrahamError(parsed.error.issues[0]?.message ?? 'Revise as premissas de Graham.')
      setGrahamResult(null)
      return
    }

    const preco = calcularPrecoGraham(parsed.data)
    if (preco === null || preco <= 0) {
      setGrahamError('Informe LPA e VPA maiores que zero para calcular o preço de Graham.')
      setGrahamResult(null)
      return
    }

    setGrahamResult(preco)
    setValue('precoTeto', formatMoneyInput(preco), { shouldValidate: true })
  }

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

        <Accordion
          titulo="Fluxo de Caixa Descontado (FCD)"
          descricao="Calcule o preço justo a partir do fluxo de caixa projetado."
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              O FCD projeta o <strong>fluxo de caixa livre (FCL)</strong> por um período, traz os
              fluxos a valor presente pela <strong>taxa de desconto</strong> (WACC) e soma o valor
              na perpetuidade. O preço justo por ação é{' '}
              <em>(valor da firma − dívida líquida) ÷ quantidade de ações</em>.
            </p>

            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>
                <strong>FCL atual:</strong> caixa gerado pela empresa nos últimos 12 meses.
              </li>
              <li>
                <strong>Dívida líquida:</strong> dívida total − caixa (negativo = caixa líquido).
              </li>
              <li>
                <strong>Ações (milhões):</strong> quantidade de ações em circulação.
              </li>
              <li>
                <strong>Crescimento FCL:</strong> crescimento anual do fluxo no período de
                projeção.
              </li>
              <li>
                <strong>Taxa de desconto:</strong> custo de oportunidade (WACC) exigido ao ano.
              </li>
              <li>
                <strong>Anos de projeção:</strong> horizonte da projeção (ex.: 5 ou 10 anos).
              </li>
              <li>
                <strong>Crescimento na perpetuidade:</strong> crescimento estável após a projeção
                (deve ser menor que a taxa de desconto).
              </li>
            </ul>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="valuation-fcl"
                label="FCL Atual (R$)"
                hint="Fluxo de caixa livre dos últimos 12 meses (em reais)."
                error={errors.fclAtual?.message}
              >
                <input
                  id="valuation-fcl"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 10.000.000.000,00"
                  className={inputClassName}
                  {...register('fclAtual')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-divida"
                label="Dívida Líquida (R$)"
                hint="Dívida total − caixa. Use negativo para caixa líquido."
                error={errors.dividaLiquida?.message}
              >
                <input
                  id="valuation-divida"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 2.000.000.000,00"
                  className={inputClassName}
                  {...register('dividaLiquida')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-acoes"
                label="Ações (milhões)"
                hint="Quantidade de ações em circulação, em milhões."
                error={errors.acoesMilhoes?.message}
              >
                <input
                  id="valuation-acoes"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 500"
                  className={inputClassName}
                  {...register('acoesMilhoes')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-crescimento"
                label="Crescimento FCL (% a.a.)"
                hint="Crescimento anual do fluxo de caixa na projeção."
                error={errors.crescimentoAno?.message}
              >
                <input
                  id="valuation-crescimento"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 10"
                  className={inputClassName}
                  {...register('crescimentoAno')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-taxa"
                label="Taxa de Desconto (% a.a.)"
                hint="Custo de oportunidade (WACC) exigido ao ano."
                error={errors.taxaDesconto?.message}
              >
                <input
                  id="valuation-taxa"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 12"
                  className={inputClassName}
                  {...register('taxaDesconto')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-anos"
                label="Anos de Projeção"
                hint="Horizonte da projeção (1 a 50 anos)."
                error={errors.anosProjecao?.message}
              >
                <input
                  id="valuation-anos"
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex.: 10"
                  className={inputClassName}
                  {...register('anosProjecao')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-perpetuidade"
                label="Crescimento na Perpetuidade (% a.a.)"
                hint="Crescimento estável após a projeção; deve ser menor que a taxa de desconto."
                error={errors.crescimentoPerpetuidade?.message}
              >
                <input
                  id="valuation-perpetuidade"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 3"
                  className={inputClassName}
                  {...register('crescimentoPerpetuidade')}
                />
              </FormField>
            </div>

            {dcfError ? <Alert variant="error">{dcfError}</Alert> : null}

            {dcfResult ? (
              <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Resultado do FCD
                </p>
                <p className="text-sm text-slate-700">
                  Valor da firma:{' '}
                  <span className="font-semibold tabular-nums">
                    {formatarCentavos(dcfResult.valorDaFirma)}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Valor patrimonial:{' '}
                  <span className="font-semibold tabular-nums">
                    {formatarCentavos(dcfResult.valorPatrimonio)}
                  </span>
                </p>
                <p className="text-sm text-slate-700">
                  Preço justo por ação:{' '}
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {formatarCentavos(dcfResult.precoJusto)}
                  </span>
                  {dcfResult.precoJusto > 0 ? (
                    <span className="ml-1 text-xs text-emerald-600">
                      (aplicado ao Preço Teto)
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCalcularDcf}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Calcular preço justo
              </button>
              {dcfResult && dcfResult.precoJusto > 0 ? (
                <span className="text-xs text-slate-500">
                  Preço Teto preenchido com {formatarCentavos(dcfResult.precoJusto)}.
                </span>
              ) : null}
            </div>
          </div>
        </Accordion>

        <Accordion
          titulo="Preço Justo de Graham"
          descricao="Estimativa conservadora a partir do lucro e do patrimônio por ação."
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              A fórmula de Graham estima o valor justo com base em fundamentos:
            </p>

            <p className="rounded-md bg-slate-50 px-3 py-2 text-center font-mono text-sm text-slate-700">
              V = √(22,5 × LPA × VPA)
            </p>

            <div className="space-y-3 text-sm text-slate-600">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-800">Como achar o LPA (Lucro por Ação)</p>
                <p className="mt-1">
                  <strong>Fórmula:</strong> lucro líquido dos últimos 12 meses ÷ quantidade de
                  ações.
                </p>
                <p className="mt-1">
                  <strong>Onde encontrar:</strong> no site de Relações com Investidores (RI) da
                  empresa (DRE — Demonstração do Resultado) ou em sites de fundamentos como
                  Status Invest e Fundamentus, que já trazem o valor pronto como{' '}
                  <em>LPA</em> (ou <em>EPS</em>, em inglês).
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-800">Como achar o VPA (Valor Patrimonial por Ação)</p>
                <p className="mt-1">
                  <strong>Fórmula:</strong> patrimônio líquido ÷ quantidade de ações.
                </p>
                <p className="mt-1">
                  <strong>Onde encontrar:</strong> no Balanço Patrimonial da empresa (linha
                  "Patrimônio Líquido", no site de RI) ou em sites de fundamentos como Status
                  Invest e Fundamentus, que já trazem o valor pronto como <em>VPA</em>.
                </p>
              </div>

              <p>
                O fator <strong>22,5</strong> combina P/L máximo de 15 com P/VPA máximo de 1,5.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="valuation-lpa"
                label="LPA — Lucro por Ação (R$)"
                hint="Lucro líquido por ação dos últimos 12 meses (em reais)."
                error={errors.lpa?.message}
              >
                <input
                  id="valuation-lpa"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 5,00"
                  className={inputClassName}
                  {...register('lpa')}
                />
              </FormField>

              <FormField
                htmlFor="valuation-vpa"
                label="VPA — Valor Patrimonial por Ação (R$)"
                hint="Patrimônio líquido dividido pela quantidade de ações (em reais)."
                error={errors.vpa?.message}
              >
                <input
                  id="valuation-vpa"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 40,00"
                  className={inputClassName}
                  {...register('vpa')}
                />
              </FormField>
            </div>

            {grahamError ? <Alert variant="error">{grahamError}</Alert> : null}

            {grahamResult ? (
              <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Resultado de Graham
                </p>
                <p className="text-sm text-slate-700">
                  Preço justo por ação:{' '}
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {formatarCentavos(grahamResult)}
                  </span>
                  <span className="ml-1 text-xs text-emerald-600">(aplicado ao Preço Teto)</span>
                </p>
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCalcularGraham}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Calcular preço justo
              </button>
              {grahamResult ? (
                <span className="text-xs text-slate-500">
                  Preço Teto preenchido com {formatarCentavos(grahamResult)}.
                </span>
              ) : null}
            </div>
          </div>
        </Accordion>

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
