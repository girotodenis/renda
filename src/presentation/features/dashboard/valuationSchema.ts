import { z } from 'zod'
import { formatMoneyInput, parseBRL, parseDecimalBR, toCentavos } from '@/lib/money'
import type { CategoriaAtivo, Valuation } from '@/types/domain'

/**
 * Schema `zod` do formulário de valuation (aba `Valuation`) — alerta de
 * oportunidade de compra.
 *
 * Todos os campos são opcionais (vazios = análise removida). O preço teto entra
 * como texto pt-BR (`"100,00"`) e sai em **centavos**; a margem entra como
 * percentual (`"20"` = 20%).
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

export const valuationFormSchema = z.object({
  precoTeto: optionalPriceTeto,
  margemSeguranca: optionalMargem,
  anotacoes: z
    .string()
    .trim()
    .max(2000, 'As anotações devem ter no máximo 2000 caracteres.'),
})

/** Valores crus do formulário (entrada do schema). */
export type ValuationFormInput = z.input<typeof valuationFormSchema>

/** Valores validados/transformados do formulário (saída do schema). */
export type ValuationFormOutput = z.output<typeof valuationFormSchema>

/** Valores iniciais do formulário a partir de uma análise existente (ou vazio). */
export function valuationFormDefaults(valuation?: Valuation | null): ValuationFormInput {
  if (!valuation) {
    return { precoTeto: '', margemSeguranca: '', anotacoes: '' }
  }
  return {
    precoTeto: valuation.precoTeto !== null ? formatMoneyInput(valuation.precoTeto) : '',
    margemSeguranca:
      valuation.margemSeguranca !== null
        ? String(valuation.margemSeguranca).replace('.', ',')
        : '',
    anotacoes: valuation.anotacoes ?? '',
  }
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
  }
}
