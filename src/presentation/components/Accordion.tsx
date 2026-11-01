import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/presentation/cn'

interface AccordionProps {
  /** Título do cabeçalho clicável. */
  titulo: string
  /** Descrição curta exibida ao lado do título (opcional). */
  descricao?: string
  /** Inicia aberto quando `true` (modo não controlado). */
  defaultAberto?: boolean
  /**
   * Modo controlado: quando informado, o aberto/fechado passa a ser do
   * componente pai (útil para abrir a seção a partir de outro bloco).
   */
  aberto?: boolean
  /** Notifica a intenção de abrir/fechar (também no modo controlado). */
  onAbertoChange?: (aberto: boolean) => void
  children: ReactNode
}

/**
 * Accordion acessível: cabeçalho clicável que expande/recolhe o conteúdo.
 * Usado para seções secundárias dos formulários (ex.: premissas do FCD).
 */
export function Accordion({
  titulo,
  descricao,
  defaultAberto = false,
  aberto,
  onAbertoChange,
  children,
}: AccordionProps) {
  const [abertoInterno, setAbertoInterno] = useState(defaultAberto)
  const controlado = aberto !== undefined
  const estaAberto = controlado ? aberto : abertoInterno

  function alternar() {
    const proximo = !estaAberto
    if (!controlado) setAbertoInterno(proximo)
    onAbertoChange?.(proximo)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={estaAberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">{titulo}</span>
          {descricao ? <span className="block text-xs text-slate-500">{descricao}</span> : null}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200',
            estaAberto && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {estaAberto ? <div className="border-t border-slate-200 px-4 py-4">{children}</div> : null}
    </div>
  )
}
