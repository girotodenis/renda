import { z } from 'zod'
import { formatMoneyInput, parseBRL, toCentavos } from '@/domain/money'
import { CategoriaAtivo, ProventoTipo } from '@/domain/entities'
import type { Provento } from '@/domain/entities'

/**
 * Schema `zod` do formulário de provento (dividendo/JCP/rendimento) — RF05.
 *
 * `Valor Total` entra como texto pt-BR (`"1.234,56"`) e sai em **centavos
 * inteiros**; datas seguem ISO `YYYY-MM-DD` (input `type="date"`).
 */

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const proventoFormSchema = z.object({
  dataCom: z
    .string()
    .refine((value) => value === '' || ISO_DATE_REGEX.test(value), 'Data inválida.'),
  dataPagamento: z
    .string()
    .min(1, 'Informe a data de pagamento.')
    .regex(ISO_DATE_REGEX, 'Data inválida.'),
  categoria: z.nativeEnum(CategoriaAtivo, {
    errorMap: () => ({ message: 'Selecione a categoria do ativo.' }),
  }),
  ticker: z
    .string()
    .trim()
    .min(1, 'Informe o ticker do ativo.')
    .transform((value) => value.toUpperCase()),
  tipo: z.nativeEnum(ProventoTipo, {
    errorMap: () => ({ message: 'Selecione o tipo do provento.' }),
  }),
  valorTotal: z
    .string()
    .transform((raw, ctx) => {
      const value = parseBRL(raw)
      if (value === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o valor total.' })
        return z.NEVER
      }
      return toCentavos(value)
    })
    .refine((centavos) => centavos > 0, 'O valor total deve ser maior que zero.'),
})

/** Valores crus do formulário (entrada do schema). */
export type ProventoFormInput = z.input<typeof proventoFormSchema>

/** Valores validados/transformados do formulário (saída do schema). */
export type ProventoFormOutput = z.output<typeof proventoFormSchema>

/** Converte a saída validada do formulário na entidade de domínio (sem `id`). */
export function toProventoPayload(values: ProventoFormOutput): Omit<Provento, 'id'> {
  return {
    dataCom: values.dataCom === '' ? null : values.dataCom,
    dataPagamento: values.dataPagamento,
    categoria: values.categoria,
    ticker: values.ticker,
    tipo: values.tipo,
    valorTotal: values.valorTotal,
  }
}

/** Valores iniciais do formulário a partir de um provento (edição) ou vazio (novo). */
export function proventoFormDefaults(provento?: Provento): ProventoFormInput {
  if (!provento) {
    return {
      dataCom: '',
      dataPagamento: '',
      categoria: CategoriaAtivo.Acao,
      ticker: '',
      tipo: ProventoTipo.Dividendo,
      valorTotal: '',
    }
  }
  return {
    dataCom: provento.dataCom ?? '',
    dataPagamento: provento.dataPagamento,
    categoria: provento.categoria,
    ticker: provento.ticker,
    tipo: provento.tipo,
    valorTotal: formatMoneyInput(provento.valorTotal),
  }
}
