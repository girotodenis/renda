import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Classes padrão dos inputs de formulário (texto, número, data e select). */
export const inputClassName =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-slate-50'

interface FormFieldProps {
  /** `id` do input associado ao rótulo (acessibilidade). */
  htmlFor: string
  label: string
  /** Mensagem de erro de validação (exibida em vermelho). */
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}

/** Wrapper de campo de formulário: rótulo + controle + dica/erro (pt-BR). */
export function FormField({ htmlFor, label, error, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
