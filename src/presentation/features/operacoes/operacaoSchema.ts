import { z } from 'zod'
import { isRendaFixa, permiteMarcacaoManual } from '@/lib/categoria'
import { formatMoneyInput, parseBRL, parseDecimalBR, toCentavos } from '@/lib/money'
import { CategoriaAtivo, IndexadorRendaFixa, OPERACAO_MOVIMENTO_TIPOS, OperacaoTipo } from '@/types/domain'
import type { Operacao } from '@/types/domain'

/**
 * Schema `zod` do formulário de operação (compra/venda) — RF04.
 *
 * Os campos monetários entram como texto pt-BR (`"1.234,56"`) e saem em
 * **centavos inteiros**; datas seguem ISO `YYYY-MM-DD` (input `type="date"`).
 * Campos de Renda Fixa só são exigidos quando `categoria === RendaFixa`.
 */

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const requiredDateField = (emptyMessage: string) =>
  z.string().min(1, emptyMessage).regex(ISO_DATE_REGEX, 'Data inválida.')

const optionalDateField = z
  .string()
  .refine((value) => value === '' || ISO_DATE_REGEX.test(value), 'Data inválida.')

/** Quantidade > 0 (aceita decimais em pt-BR, ex.: fracionário de TD/RF). */
const quantityField = z
  .string()
  .transform((raw, ctx) => {
    const value = parseDecimalBR(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe uma quantidade válida.' })
      return z.NEVER
    }
    return value
  })
  .refine((value) => value > 0, 'A quantidade deve ser maior que zero.')

/** Dinheiro obrigatório > 0, em centavos. */
const requiredMoneyField = (label: string) =>
  z
    .string()
    .transform((raw, ctx) => {
      const value = parseBRL(raw)
      if (value === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Informe ${label}.` })
        return z.NEVER
      }
      return toCentavos(value)
    })
    .refine((centavos) => centavos > 0, `${label} deve ser maior que zero.`)

/** Taxas: opcional (vazio = 0), nunca negativo, em centavos. */
const feesField = z
  .string()
  .transform((raw, ctx) => {
    if (raw.trim().length === 0) return 0
    const value = parseBRL(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um valor de taxas válido.' })
      return z.NEVER
    }
    return toCentavos(value)
  })
  .refine((centavos) => centavos >= 0, 'As taxas não podem ser negativas.')

/** Dinheiro opcional (vazio = `null`), em centavos. */
const optionalMoneyField = z.string().transform((raw, ctx) => {
  if (raw.trim().length === 0) return null
  const value = parseBRL(raw)
  if (value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um valor válido.' })
    return z.NEVER
  }
  return toCentavos(value)
})

/** Percentual opcional (vazio = `null`), ex.: `110` para 110% do CDI. */
const optionalPercentField = z.string().transform((raw, ctx) => {
  if (raw.trim().length === 0) return null
  const value = parseDecimalBR(raw)
  if (value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um percentual válido.' })
    return z.NEVER
  }
  return value
})

export const operacaoFormSchema = z
  .object({
    data: requiredDateField('Informe a data da operação.'),
    tipo: z.enum(OPERACAO_MOVIMENTO_TIPOS, {
      errorMap: () => ({ message: 'Selecione o tipo da operação.' }),
    }),
    categoria: z.nativeEnum(CategoriaAtivo, {
      errorMap: () => ({ message: 'Selecione a categoria do ativo.' }),
    }),
    ticker: z
      .string()
      .trim()
      .min(1, 'Informe o ticker do ativo.')
      .transform((value) => value.toUpperCase()),
    quantidade: quantityField,
    precoUnitario: requiredMoneyField('o preço unitário'),
    taxas: feesField,
    indexador: z.union([z.nativeEnum(IndexadorRendaFixa), z.literal('')]),
    percentualIndexador: optionalPercentField,
    vencimento: optionalDateField,
    valorBrutoAtual: optionalMoneyField,
  })
  .superRefine((values, ctx) => {
    if (!isRendaFixa(values.categoria)) return
    if (values.indexador === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['indexador'],
        message: 'Selecione o indexador (CDI, IPCA ou Prefixado).',
      })
    }
    if (values.percentualIndexador === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentualIndexador'],
        message: 'Informe o % do indexador (ex.: 110 para 110% do CDI).',
      })
    }
    if (values.percentualIndexador !== null && values.percentualIndexador <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentualIndexador'],
        message: 'O % do indexador deve ser maior que zero.',
      })
    }
    if (values.vencimento === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vencimento'],
        message: 'Informe a data de vencimento.',
      })
    }
  })

/** Valores crus do formulário (entrada do schema). */
export type OperacaoFormInput = z.input<typeof operacaoFormSchema>

/** Valores validados/transformados do formulário (saída do schema). */
export type OperacaoFormOutput = z.output<typeof operacaoFormSchema>

/** Converte a saída validada do formulário na entidade de domínio (sem `id`). */
export function toOperacaoPayload(values: OperacaoFormOutput): Omit<Operacao, 'id'> {
  const rendaFixa = isRendaFixa(values.categoria)
  return {
    data: values.data,
    tipo: values.tipo,
    categoria: values.categoria,
    ticker: values.ticker,
    quantidade: values.quantidade,
    precoUnitario: values.precoUnitario,
    taxas: values.taxas,
    indexador: rendaFixa && values.indexador !== '' ? values.indexador : null,
    percentualIndexador: rendaFixa ? values.percentualIndexador : null,
    vencimento: rendaFixa && values.vencimento !== '' ? values.vencimento : null,
    // Renda Fixa e Tesouro Direto preservam a marcação manual do valor atual —
    // inclusive ao editar a operação (o valor é pré-carregado em
    // `operacaoFormDefaults`), sem ser apagado por falhas de integração (RF19).
    valorBrutoAtual: permiteMarcacaoManual(values.categoria) ? values.valorBrutoAtual : null,
  }
}

/** Valores iniciais do formulário a partir de uma operação (edição) ou vazio (novo). */
export function operacaoFormDefaults(operacao?: Operacao): OperacaoFormInput {
  if (!operacao) {
    return {
      data: '',
      tipo: OperacaoTipo.Compra,
      categoria: CategoriaAtivo.Acao,
      ticker: '',
      quantidade: '',
      precoUnitario: '',
      taxas: '',
      indexador: '',
      percentualIndexador: '',
      vencimento: '',
      valorBrutoAtual: '',
    }
  }
  return {
    data: operacao.data,
    tipo: operacao.tipo === OperacaoTipo.Venda ? OperacaoTipo.Venda : OperacaoTipo.Compra,
    categoria: operacao.categoria,
    ticker: operacao.ticker,
    quantidade: String(operacao.quantidade).replace('.', ','),
    precoUnitario: formatMoneyInput(operacao.precoUnitario),
    taxas: operacao.taxas > 0 ? formatMoneyInput(operacao.taxas) : '',
    indexador: operacao.indexador ?? '',
    percentualIndexador:
      operacao.percentualIndexador !== null
        ? String(operacao.percentualIndexador).replace('.', ',')
        : '',
    vencimento: operacao.vencimento ?? '',
    valorBrutoAtual:
      operacao.valorBrutoAtual !== null ? formatMoneyInput(operacao.valorBrutoAtual) : '',
  }
}
