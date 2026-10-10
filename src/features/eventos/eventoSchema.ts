import { z } from 'zod'
import { newId } from '@/lib/ids'
import { parseDecimalBR } from '@/lib/money'
import { eventoParaOperacao } from '@/lib/eventosCorporativos'
import type { EventoCorporativo } from '@/lib/eventosCorporativos'
import { CategoriaAtivo, EVENTO_CORPORATIVO_TIPOS, OperacaoTipo } from '@/types/domain'
import type { Operacao } from '@/types/domain'

/**
 * Schema `zod` do formulário de evento corporativo (RF20, Seção 5.6).
 *
 * O `valor` é o parâmetro do evento (fator `N` do split/grupamento ou o
 * percentual `x` da bonificação), digitado em pt-BR.
 */

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const valorField = z
  .string()
  .transform((raw, ctx) => {
    const value = parseDecimalBR(raw)
    if (value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o fator/percentual do evento.' })
      return z.NEVER
    }
    return value
  })
  .refine((value) => value > 0, 'O fator/percentual deve ser maior que zero.')

export const eventoFormSchema = z
  .object({
    data: z
      .string()
      .min(1, 'Informe a data do evento.')
      .regex(ISO_DATE_REGEX, 'Data inválida.'),
    categoria: z.nativeEnum(CategoriaAtivo, {
      errorMap: () => ({ message: 'Selecione a categoria do ativo.' }),
    }),
    ticker: z
      .string()
      .trim()
      .min(1, 'Informe o ticker do ativo.')
      .transform((value) => value.toUpperCase()),
    tipo: z.enum(EVENTO_CORPORATIVO_TIPOS, {
      errorMap: () => ({ message: 'Selecione o tipo de evento.' }),
    }),
    valor: valorField,
  })
  .superRefine((values, ctx) => {
    if (
      (values.tipo === OperacaoTipo.Split || values.tipo === OperacaoTipo.Grupamento) &&
      values.valor <= 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valor'],
        message: 'O fator deve ser maior que 1 (ex.: 2 para 1:2 ou 10 para 10:1).',
      })
    }
    if (values.tipo === OperacaoTipo.Bonificacao && values.valor >= 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valor'],
        message: 'Informe um percentual de bonificação válido.',
      })
    }
  })

export type EventoFormInput = z.input<typeof eventoFormSchema>
export type EventoFormOutput = z.output<typeof eventoFormSchema>

/** Converte a saída validada do formulário no evento de domínio. */
export function toEventoPayload(values: EventoFormOutput): EventoCorporativo {
  return {
    id: newId(),
    data: values.data,
    ticker: values.ticker,
    categoria: values.categoria,
    tipo: values.tipo,
    valor: values.valor,
  }
}

/** Converte o evento na linha da aba `Operacoes` (persistência). */
export function eventoToOperacao(evento: EventoCorporativo): Operacao {
  return eventoParaOperacao(evento)
}

/** Valores iniciais do formulário de evento. */
export function eventoFormDefaults(today: string): EventoFormInput {
  return {
    data: today,
    categoria: CategoriaAtivo.Acao,
    ticker: '',
    tipo: OperacaoTipo.Split,
    valor: '',
  }
}
