import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/presentation/cn'

interface PaginationProps {
  /** Página atual (1-indexada). */
  page: number
  /** Quantidade de registros por página. */
  pageSize: number
  /** Total de registros da lista. */
  total: number
  /** Notifica a mudança de página. */
  onPageChange: (page: number) => void
  className?: string
}

/** Janela de páginas ao redor da atual, com reticências quando há muitas. */
function calcularPaginas(current: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, indice) => indice + 1)
  }

  const paginas: (number | '...')[] = [1]
  const inicio = Math.max(2, current - 1)
  const fim = Math.min(totalPages - 1, current + 1)

  if (inicio > 2) paginas.push('...')
  for (let pagina = inicio; pagina <= fim; pagina += 1) paginas.push(pagina)
  if (fim < totalPages - 1) paginas.push('...')
  paginas.push(totalPages)

  return paginas
}

/**
 * Paginador reutilizável: exibe o intervalo visível ("Mostrando X–Y de N") e a
 * navegação entre páginas (anterior/próxima + números), acessível por teclado.
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(page, 1), totalPages)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, total)
  const paginas = calcularPaginas(current, totalPages)

  return (
    <nav
      aria-label="Paginação"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 text-sm',
        className,
      )}
    >
      <p className="text-xs text-slate-500" aria-live="polite">
        {total === 0 ? 'Nenhum registro' : `Mostrando ${from}–${to} de ${total}`}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Página anterior"
          className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>

        {paginas.map((pagina, indice) =>
          pagina === '...' ? (
            <span key={`reticencias-${indice}`} className="px-1 text-slate-400" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={pagina}
              type="button"
              onClick={() => onPageChange(pagina)}
              aria-current={pagina === current ? 'page' : undefined}
              className={cn(
                'min-w-[2rem] rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
                pagina === current
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              {pagina}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= totalPages}
          aria-label="Próxima página"
          className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </nav>
  )
}
