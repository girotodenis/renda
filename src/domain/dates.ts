import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/**
 * Utilidades de data.
 *
 * Convenção do projeto: datas circulam internamente no formato ISO
 * (`YYYY-MM-DD`) e são exibidas no formato brasileiro (`DD/MM/AAAA`).
 */

function toDate(value: Date | string): Date {
  return typeof value === 'string' ? parseISO(value) : value
}

/**
 * Normaliza uma data para o formato ISO `YYYY-MM-DD` (ex.: `"2026-10-07"`).
 */
export function toISO(value: Date | string): string {
  return format(toDate(value), 'yyyy-MM-dd')
}

/**
 * Formata uma data para exibição em pt-BR no padrão `DD/MM/AAAA`
 * (ex.: `"2026-10-07"` → `"07/10/2026"`).
 */
export function formatarDataBR(value: Date | string): string {
  return format(toDate(value), 'dd/MM/yyyy', { locale: ptBR })
}

/**
 * Formata um mês no formato `YYYY-MM` para exibição em pt-BR
 * (ex.: `"2026-03"` → `"Março de 2026"`). Entradas inválidas retornam o
 * próprio valor.
 */
export function formatarMesAnoBR(mesIso: string): string {
  const [ano, mes] = mesIso.split('-')
  const anoNumero = Number(ano)
  const mesNumero = Number(mes)
  if (!Number.isInteger(anoNumero) || !Number.isInteger(mesNumero) || mesNumero < 1 || mesNumero > 12) {
    return mesIso
  }
  const texto = format(new Date(anoNumero, mesNumero - 1, 1), "MMMM 'de' yyyy", { locale: ptBR })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
