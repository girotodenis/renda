import { ArrowLeftRight, Coins, FileUp, Layers, LayoutDashboard, LogIn, LogOut, Scale, Settings, Stethoscope, Wallet, WifiOff } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'
import { cn } from '@/presentation/cn'
import { useOnlineStatus } from '@/presentation/hooks/useOnlineStatus'
import { SyncStatusBadge } from '@/presentation/components/SyncStatusBadge'
import { useSyncStatus } from '@/presentation/hooks/useSyncStatus'

const navItemClass = 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all'

const ctaClass = 'inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2 text-sm font-bold text-white shadow-md shadow-brand-600/40 transition-all hover:shadow-lg hover:shadow-brand-600/50'

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
        { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false },
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
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <NavLink to="/" className="group flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-600/30 transition-transform group-hover:scale-105">
                <Wallet className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-lg font-bold tracking-tight text-slate-900">Minhas Ações</span>
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
                        to === '/login' ? ctaClass : navItemClass,
                        to !== '/login' &&
                          (isActive
                            ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                            : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700'),
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
                    className={cn(navItemClass, 'border border-slate-200 text-slate-600 hover:bg-brand-50 hover:text-brand-700')}
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

      <footer className="border-t border-slate-200/70 bg-white/75 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-4 text-sm text-slate-500">
          Minhas Ações · Controle de investimentos e rebalanceamento
        </div>
      </footer>
    </div>
  )
}
