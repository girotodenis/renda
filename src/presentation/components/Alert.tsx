import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/presentation/cn'

export type AlertVariant = 'error' | 'info' | 'success'

interface AlertProps {
  variant?: AlertVariant
  title?: string
  children?: ReactNode
  className?: string
}

const variantStyles: Record<AlertVariant, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
}

const variantIcons: Record<AlertVariant, typeof Info> = {
  error: AlertTriangle,
  info: Info,
  success: CheckCircle2,
}

/** Bloco de mensagem (erro/informação/sucesso) reutilizável na UI. */
export function Alert({ variant = 'info', title, children, className }: AlertProps) {
  const Icon = variantIcons[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', variantStyles[variant], className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="[&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1">{children}</div> : null}
      </div>
    </div>
  )
}
