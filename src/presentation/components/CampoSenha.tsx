import { Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { cn } from '@/presentation/cn'

/** Props do campo de senha (controlado pelo formulário que o usa). */
export interface CampoSenhaProps {
  valor: string
  aoMudar: (valor: string) => void
  /** Rótulo sempre visível: placeholder sozinho não é acessível. */
  rotulo?: string
  /** `id` do input; sem ele, um id estável é gerado (rótulo + erro apontam para ele). */
  id?: string
  /** Mensagem de erro (vai para `aria-describedby` e é anunciada por `aria-live`). */
  erro?: string | null
  /** Foco automático ao montar (tela de bloqueio e modais de senha). */
  autoFocus?: boolean
  desabilitado?: boolean
  autoComplete?: 'current-password' | 'new-password'
  placeholder?: string
  /** Chamado ao pressionar `Enter` (envia sem depender do botão). */
  aoEnviar?: () => void
  className?: string
}

/**
 * Campo de senha reutilizável (§6.8): olho para mostrar/ocultar, rótulo
 * associado, erro anunciado e `Enter` como atalho de envio. Todos os pontos que
 * pedem a chave usam este componente para manter o comportamento igual.
 */
export function CampoSenha({
  valor,
  aoMudar,
  rotulo = 'Senha',
  id,
  erro,
  autoFocus = false,
  desabilitado = false,
  autoComplete = 'current-password',
  placeholder,
  aoEnviar,
  className,
}: CampoSenhaProps) {
  const gerado = useId()
  const campoId = id ?? gerado
  const erroId = `${campoId}-erro`
  const [visivel, setVisivel] = useState(false)

  function aoTeclar(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !aoEnviar) return
    event.preventDefault()
    aoEnviar()
  }

  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={campoId} className="block text-sm font-medium text-slate-700">
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={campoId}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(event) => aoMudar(event.target.value)}
          onKeyDown={aoTeclar}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          disabled={desabilitado}
          placeholder={placeholder}
          aria-invalid={Boolean(erro)}
          aria-describedby={erro ? erroId : undefined}
          className={cn(
            'w-full rounded-md border bg-white px-3 py-2 pr-11 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50',
            erro
              ? 'border-red-200 focus:border-red-400 focus:ring-red-100'
              : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/30',
          )}
        />
        <button
          type="button"
          onClick={() => setVisivel((atual) => !atual)}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visivel}
          disabled={desabilitado}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed"
        >
          {visivel ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {/* Sempre presente para o leitor de tela anunciar a mensagem quando ela aparece. */}
      <p
        id={erroId}
        role="alert"
        aria-live="polite"
        className={cn('text-xs font-medium text-red-700', erro ? '' : 'sr-only')}
      >
        {erro ?? ''}
      </p>
    </div>
  )
}
