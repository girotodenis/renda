import { Lock } from 'lucide-react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { cn } from '@/presentation/cn'
import { ConfirmarBloqueio } from '@/presentation/components/ConfirmarBloqueio'

/**
 * Indicador de cofre cifrado no cabeçalho (§5.6 / §6.4).
 *
 * Só aparece quando o banco ativo está cifrado. A ação "Bloquear agora" **sempre
 * pede confirmação** (decisão 12) porque ela descarta o cache de abas em claro e
 * esquece a chave: sem a senha o usuário não volta aos dados — a confirmação é a
 * mesma do Diagnóstico (`ConfirmarBloqueio`).
 */
export function BadgeProtegido() {
  const { criptografiaDoBanco } = useAuth()

  if (criptografiaDoBanco !== 'total') return null

  return (
    <>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
          'border-emerald-200 bg-emerald-50 text-emerald-800',
        )}
        title="Os dados deste banco estão cifrados no arquivo do Drive"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        <span>Protegido</span>
      </span>

      <ConfirmarBloqueio rotulo="Bloquear" />
    </>
  )
}
