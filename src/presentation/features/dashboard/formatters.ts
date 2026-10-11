import { cn } from '@/presentation/cn'
import { formatarBRL, fromCentavos } from '@/domain/money'

/** Formatadores de exibição do dashboard (pt-BR / BRL). */

/** Formata um valor em **centavos** como moeda brasileira (ex.: `1999` → `R$ 19,99`). */
export function formatarCentavos(centavos: number): string {
  return formatarBRL(fromCentavos(centavos))
}

const compacto = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 1,
})

/** Formata centavos de forma compacta (ex.: `R$ 1,2 mi`) — para eixos de gráfico. */
export function formatarCentavosCompacto(centavos: number): string {
  return compacto.format(fromCentavos(centavos))
}

/** Formata um percentual (ex.: `12.5` → `"12,50%"`). */
export function formatarPercentual(valor: number): string {
  return `${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

/** Classe Tailwind de cor conforme o sinal (positivo/negativo/neutro). */
export function classeValor(valor: number): string {
  return cn(
    valor > 0 && 'text-emerald-600',
    valor < 0 && 'text-red-600',
    valor === 0 && 'text-slate-500',
  )
}
