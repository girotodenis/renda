import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combina classes CSS condicionais (`clsx`) resolvendo conflitos do Tailwind
 * (`tailwind-merge`). Uso típico: `cn('p-2', ativo && 'bg-brand-600')`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
