import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/presentation/cn'

interface ModalProps {
  /** Controla a visibilidade (`false` não renderiza nada). */
  open: boolean
  /** Chamado ao fechar (Esc, clique no backdrop ou botão fechar). */
  onClose: () => void
  /** Título exibido no cabeçalho e usado como rótulo acessível do diálogo. */
  titulo: ReactNode
  children: ReactNode
  /** Classe extra aplicada ao painel (largura etc.). */
  className?: string
  /** Ações extras exibidas no lado direito do cabeçalho (antes do botão fechar). */
  acoes?: ReactNode
}

/**
 * Modal acessível e reutilizável (overlay fixo + `role="dialog"`).
 *
 * Comportamentos: fecha com **Esc**, clique no **backdrop** e botão **Fechar**;
 * bloqueia o scroll do body enquanto aberto; move o foco para o painel ao abrir
 * e devolve o foco ao elemento anterior ao fechar.
 */
export function Modal({ open, onClose, titulo, children, className, acoes }: ModalProps) {
  const tituloId = useId()
  const painelRef = useRef<HTMLDivElement>(null)
  const focoAnteriorRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    focoAnteriorRef.current = document.activeElement as HTMLElement | null
    painelRef.current?.focus()

    function aoTeclar(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', aoTeclar)
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAnterior
      focoAnteriorRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn(
          'w-full max-w-3xl rounded-xl bg-white shadow-xl outline-none',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <h2 id={tituloId} className="text-lg font-semibold text-slate-900">
            {titulo}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {acoes}
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              aria-label="Fechar"
              className="-m-1 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
