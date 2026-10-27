import { z } from 'zod'
import { formatMoneyInput, parseBRL, parseDecimalBR, toCentavos } from '@/domain/money'
import type { CategoriaAtivo, Valuation } from '@/domain/entities'

/**
 * Schema `zod` do formulário de valuation (aba `Valuation`) — alerta de
 * oportunidade de compra e premissas do Fluxo de Caixa Descontado (FCD).
 *
 * Todos os campos são opcionais (vazios = análise removida). O preço teto e os
 * valores monetários entram como texto pt-BR (`"100,00"`) e saem em
 * **centavos**; percentuais entram como `"20"` (= 20%) e saem como `number`.
 */

/** Dinheiro opcional (vazio = `null`), em centavos; > 0 quando informado. */
const optionalPriceTeto = z
  .string()
  .transform((raw, ctx) => {
    if (raw.trim().length === 0) return null
    const value = parseBRL(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um preço teto válido.' })
      return z.NEVER
    }
    return toCentavos(value)
  })
  .refine((centavos) => centavos === null || centavos > 0, 'O preço teto deve ser maior que zero.')

/** Margem de segurança opcional (vazio = `null`), entre 0 e 100. */
const optionalMargem = z
  .string()
  .transform((raw, ctx) => {
    if (raw.trim().length === 0) return null
    const value = parseDecimalBR(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe uma margem válida.' })
      return z.NEVER
    }
    return value
  })
  .refine(
    (value) => value === null || (value >= 0 && value <= 100),
    'A margem de segurança deve estar entre 0 e 100.',
  )

/** Dinheiro opcional (R$) → centavos; > 0 quando preenchido (usado no FCD). */
const fclOpcional = z
  .string()
  .transform((raw, ctx) => {
    if (raw.trim().length === 0) return null
    const value = parseBRL(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um fluxo de caixa livre válido.' })
      return z.NEVER
    }
    return toCentavos(value)
  })
  .refine(
    (centavos) => centavos === null || centavos > 0,
    'O fluxo de caixa livre deve ser maior que zero.',
  )

/** Dinheiro com sinal opcional (R$) → centavos; pode ser negativo (caixa líquido). */
const dividaLiquidaOpcional = z.string().transform((raw, ctx) => {
  if (raw.trim().length === 0) return null
  const value = parseBRL(raw)
  if (value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe uma dívida líquida válida.' })
    return z.NEVER
  }
  return toCentavos(value)
})

/** Decimal opcional (pt-BR); aceita negativos. */
function decimalOpcional(message: string) {
  return z.string().transform((raw, ctx) => {
    if (raw.trim().length === 0) return null
    const value = parseDecimalBR(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
      return z.NEVER
    }
    return value
  })
}

/** Decimal positivo opcional (pt-BR). */
function decimalPositivoOpcional(message: string) {
  return decimalOpcional(message).refine(
    (value) => value === null || value > 0,
    'O valor deve ser maior que zero.',
  )
}

/** Inteiro opcional entre 1 e 50 (anos de projeção). */
const anosProjecaoOpcional = z
  .string()
  .transform((raw, ctx) => {
    if (raw.trim().length === 0) return null
    const value = parseDecimalBR(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um número inteiro de anos.' })
      return z.NEVER
    }
    return value
  })
  .refine(
    (value) => value === null || (Number.isInteger(value) && value >= 1 && value <= 50),
    'Informe um número inteiro entre 1 e 50.',
  )

/** Schema completo do formulário (todos os campos opcionais). */
export const valuationFormSchema = z.object({
  precoTeto: optionalPriceTeto,
  margemSeguranca: optionalMargem,
  anotacoes: z
    .string()
    .trim()
    .max(2000, 'As anotações devem ter no máximo 2000 caracteres.'),
  fclAtual: fclOpcional,
  dividaLiquida: dividaLiquidaOpcional,
  acoesMilhoes: decimalPositivoOpcional('Informe uma quantidade de ações válida.'),
  crescimentoAno: decimalOpcional('Informe um crescimento válido.'),
  taxaDesconto: decimalPositivoOpcional('Informe uma taxa de desconto válida.'),
  anosProjecao: anosProjecaoOpcional,
  crescimentoPerpetuidade: decimalOpcional('Informe um crescimento na perpetuidade válido.'),
})

/** Schema do FCD usado pelo botão **Calcular** (todas as premissas obrigatórias). */
export const dcfFormSchema = z.object({
  fclAtual: fclOpcional.refine(
    (value): value is number => value !== null,
    'Informe o fluxo de caixa livre atual.',
  ),
  dividaLiquida: dividaLiquidaOpcional.refine(
    (value): value is number => value !== null,
    'Informe a dívida líquida (use 0 se não houver).',
  ),
  acoesMilhoes: decimalPositivoOpcional('Informe uma quantidade de ações válida.').refine(
    (value): value is number => value !== null,
    'Informe a quantidade de ações (em milhões).',
  ),
  crescimentoAno: decimalOpcional('Informe um crescimento válido.').refine(
    (value): value is number => value !== null,
    'Informe o crescimento do FCL (% a.a.).',
  ),
  taxaDesconto: decimalPositivoOpcional('Informe uma taxa de desconto válida.').refine(
    (value): value is number => value !== null,
    'Informe a taxa de desconto (% a.a.).',
  ),
  anosProjecao: anosProjecaoOpcional.refine(
    (value): value is number => value !== null,
    'Informe os anos de projeção.',
  ),
  crescimentoPerpetuidade: decimalOpcional('Informe um crescimento na perpetuidade válido.').refine(
    (value): value is number => value !== null,
    'Informe o crescimento na perpetuidade (% a.a.).',
  ),
})

/** Valores crus do formulário (entrada do schema). */
export type ValuationFormInput = z.input<typeof valuationFormSchema>

/** Valores validados/transformados do formulário (saída do schema). */
export type ValuationFormOutput = z.output<typeof valuationFormSchema>

/** Valores validados das premissas do FCD (todas preenchidas). */
export type DcfFormOutput = z.output<typeof dcfFormSchema>

/** Valores iniciais do formulário a partir de uma análise existente (ou vazio). */
export function valuationFormDefaults(valuation?: Valuation | null): ValuationFormInput {
  if (!valuation) {
    return {
      precoTeto: '',
      margemSeguranca: '',
      anotacoes: '',
      fclAtual: '',
      dividaLiquida: '',
      acoesMilhoes: '',
      crescimentoAno: '',
      taxaDesconto: '',
      anosProjecao: '',
      crescimentoPerpetuidade: '',
    }
  }
  return {
    precoTeto: valuation.precoTeto !== null ? formatMoneyInput(valuation.precoTeto) : '',
    margemSeguranca: moneyOrDecimalInput(valuation.margemSeguranca),
    anotacoes: valuation.anotacoes ?? '',
    fclAtual: valuation.fclAtual !== null ? formatMoneyInput(valuation.fclAtual) : '',
    dividaLiquida: valuation.dividaLiquida !== null ? formatMoneyInput(valuation.dividaLiquida) : '',
    acoesMilhoes: moneyOrDecimalInput(valuation.acoesMilhoes),
    crescimentoAno: moneyOrDecimalInput(valuation.crescimentoAno),
    taxaDesconto: moneyOrDecimalInput(valuation.taxaDesconto),
    anosProjecao: moneyOrDecimalInput(valuation.anosProjecao),
    crescimentoPerpetuidade: moneyOrDecimalInput(valuation.crescimentoPerpetuidade),
  }
}

/** Formata um número opcional para o input pt-BR (vazio quando `null`). */
function moneyOrDecimalInput(value: number | null): string {
  return value !== null ? String(value).replace('.', ',') : ''
}

/** Converte a saída validada do formulário na entidade de domínio. */
export function toValuationPayload(
  values: ValuationFormOutput,
  ticker: string,
  categoria: CategoriaAtivo,
): Valuation {
  return {
    ticker,
    categoria,
    precoTeto: values.precoTeto,
    margemSeguranca: values.margemSeguranca,
    anotacoes: values.anotacoes,
    fclAtual: values.fclAtual,
    dividaLiquida: values.dividaLiquida,
    acoesMilhoes: values.acoesMilhoes,
    crescimentoAno: values.crescimentoAno,
    taxaDesconto: values.taxaDesconto,
    anosProjecao: values.anosProjecao,
    crescimentoPerpetuidade: values.crescimentoPerpetuidade,
  }
}
