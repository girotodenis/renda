import { ArrowLeftRight, Coins, FileUp, Layers, LayoutDashboard, LogIn, LogOut, Scale, Stethoscope, Wallet, WifiOff } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/app/providers/authContext'
import { cn } from '@/lib/cn'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { SyncStatusBadge } from '@/presentation/components/SyncStatusBadge'
import { useSyncStatus } from '@/presentation/hooks/useSyncStatus'

const navItemClass = 'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors'

export function AppLayout() {
  const { status, logout } = useAuth()
  const online = useOnlineStatus()
  const sync = useSyncStatus()
  const isAuthenticated = status === 'authenticated'

  const navItems = isAuthenticated
    ? ([
        { to: '/', label: 'Início', icon: Wallet, end: true },
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: false },
        { to: '/operacoes', label: 'Operações', icon: ArrowLeftRight, end: false },
        { to: '/proventos', label: 'Proventos', icon: Coins, end: false },
        { to: '/eventos', label: 'Eventos', icon: Layers, end: false },
        { to: '/importar-b3', label: 'Importar B3', icon: FileUp, end: false },
        { to: '/rebalanceamento', label: 'Rebalanceamento', icon: Scale, end: false },
        { to: '/diagnostico', label: 'Diagnóstico', icon: Stethoscope, end: false },
      ] as const)
    : ([
        { to: '/', label: 'Início', icon: Wallet, end: true },
        { to: '/login', label: 'Entrar', icon: LogIn, end: false },
      ] as const)

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Wallet className="h-5 w-5 text-brand-600" aria-hidden />
              <span>Minhas Ações</span>
            </NavLink>
            <SyncStatusBadge
              online={sync.online}
              pendentes={sync.pendentes}
              status={sync.status}
              aplicadas={sync.aplicadas}
              erro={sync.erro}
              onSync={() => void sync.syncNow()}
            />
          </div>

          <nav aria-label="Navegação principal">
            <ul className="flex flex-wrap items-center gap-1">
              {navItems.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        navItemClass,
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}

              {isAuthenticated ? (
                <li>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className={cn(navItemClass, 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sair
                  </button>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
      </header>

      {!online ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800"
        >
          <WifiOff className="h-4 w-4" aria-hidden />
          Modo offline — exibindo o último estado salvo da carteira.
        </div>
      ) : null}

      <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 focus:outline-none">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-sm text-slate-500">
          Minhas Ações · Controle de investimentos e rebalanceamento
        </div>
      </footer>
    </div>
  )
}
