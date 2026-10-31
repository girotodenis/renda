import { Modal } from '@/presentation/components/Modal'
import { cn } from '@/presentation/cn'
import type { ProgressoAtualizacao } from '@/domain/progresso'

interface ProgressoModalProps {
  /** Controla a visibilidade: `false` não renderiza nada. */
  open: boolean
  /** Progresso em andamento (`null` enquanto ainda não há o primeiro evento). */
  progresso: ProgressoAtualizacao | null
  /** Chamado pelo botão "Cancelar" (e pelo Esc/clique no backdrop). */
  onCancelar: () => void
}

/** Percentual concluído, limitado a 0–100. */
function percentualDe(progresso: ProgressoAtualizacao | null): number {
  if (!progresso || progresso.total <= 0) return 0
  return Math.min(100, Math.round((progresso.atual / progresso.total) * 100))
}

/**
 * Modal de progresso de uma operação longa (atualização do dashboard).
 *
 * Mostra o passo em execução acima da barra, o contador de itens ("3/10") e o
 * percentual logo abaixo, e um botão **Cancelar** que interrompe a operação.
 * Enquanto o total ainda é desconhecido (`total === 0`) a barra fica
 * indeterminada.
 */
export function ProgressoModal({ open, progresso, onCancelar }: ProgressoModalProps) {
  const total = progresso?.total ?? 0
  const atual = progresso?.atual ?? 0
  const determinado = total > 0
  const percentual = percentualDe(progresso)
  const contador = determinado ? `${atual}/${total}` : 'Preparando…'

  return (
    <Modal open={open} onClose={onCancelar} titulo="Atualizando dados" className="max-w-md">
      <div className="space-y-5">
        <p className="text-sm font-medium text-slate-900" aria-live="polite">
          {progresso?.etapa ?? 'Iniciando atualização…'}
        </p>

        <div className="space-y-1.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={determinado ? total : undefined}
            aria-valuenow={determinado ? atual : undefined}
            aria-valuetext={contador}
            aria-busy={!determinado}
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
          >
            <div
              className={cn(
                'h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out',
                !determinado && 'w-1/3 animate-pulse',
              )}
              style={determinado ? { width: `${percentual}%` } : undefined}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-slate-700">{contador}</span>
            {determinado ? (
              <span className="text-xs text-slate-500">{percentual}%</span>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancelar}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}
