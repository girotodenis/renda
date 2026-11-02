import { Loader2 } from 'lucide-react'
import { cn } from '@/presentation/cn'

/** Props do toggle acessível. */
export interface SwitchProps {
  /** Estado atual (o componente é controlado). */
  checked: boolean
  /** Chamado com o novo estado ao clicar ou teclar Espaço/Enter. */
  onChange: (valor: boolean) => void
  /** `id` do próprio toggle, para um `<label htmlFor>` externo. */
  id?: string
  /** `id` do elemento que rotula o toggle (título do card, `<label>`). */
  rotuloId?: string
  /** `id` do texto de apoio (vai para `aria-describedby`). */
  descricaoId?: string
  /** Nome acessível quando não há um `rotuloId` visível. */
  rotulo?: string
  /** Desabilitado com aparência neutra e sem interação. */
  disabled?: boolean
  /** Operação em andamento: spinner discreto e cliques ignorados. */
  pending?: boolean
  className?: string
}

/**
 * Toggle no padrão ARIA `switch` (§5.6).
 *
 * É um `<button>`: `Enter` e `Espaço` já disparam `click` nativamente, então o
 * teclado funciona sem handlers extras (que causariam troca dupla no Espaço).
 * O rótulo e a explicação vêm de fora por `aria-labelledby`/`aria-describedby`,
 * o que mantém o texto visível no card em vez de duplicá-lo aqui.
 */
export function Switch({
  checked,
  onChange,
  id,
  rotuloId,
  descricaoId,
  rotulo,
  disabled = false,
  pending = false,
  className,
}: SwitchProps) {
  const travado = disabled || pending

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={rotuloId}
      aria-describedby={descricaoId}
      aria-label={rotuloId ? undefined : rotulo}
      disabled={travado}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-slate-200',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        pending ? 'cursor-progress' : '',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none grid h-5 w-5 place-items-center rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin text-slate-500" aria-hidden /> : null}
      </span>
    </button>
  )
}
