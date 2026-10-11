import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'

/** Tela de carregamento exibida enquanto a sessão é restaurada. */
export function FullPageLoader({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />
      <p className="text-sm">{message}</p>
    </div>
  )
}

/** Protege rotas privadas: sem autenticação, redireciona para `/login`. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullPageLoader message="Verificando sessão..." />
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

/** Rota pública: com sessão e planilha prontas, redireciona para `/dashboard`. */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { status, workspace } = useAuth()

  if (status === 'loading') {
    return <FullPageLoader message="Verificando sessão..." />
  }
  if (status === 'authenticated' && workspace) {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}
