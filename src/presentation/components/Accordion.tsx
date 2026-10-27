import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/presentation/cn'

interface AccordionProps {
  /** Título do cabeçalho clicável. */
  titulo: string
  /** Descrição curta exibida ao lado do título (opcional). */
  descricao?: string
  /** Inicia aberto quando `true`. */
  defaultAberto?: boolean
  children: ReactNode
}

/**
 * Accordion acessível: cabeçalho clicável que expande/recolhe o conteúdo.
 * Usado para seções secundárias dos formulários (ex.: premissas do FCD).
 */
export function Accordion({ titulo, descricao, defaultAberto = false, children }: AccordionProps) {
  const [aberto, setAberto] = useState(defaultAberto)

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setAberto((valor) => !valor)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">{titulo}</span>
          {descricao ? <span className="block text-xs text-slate-500">{descricao}</span> : null}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200',
            aberto && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {aberto ? <div className="border-t border-slate-200 px-4 py-4">{children}</div> : null}
    </div>
  )
}
