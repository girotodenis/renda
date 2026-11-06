import { ArrowLeftRight, Coins, FileUp, HardDrive, Layers, LayoutDashboard, LogIn, LogOut, Menu, Scale, Settings, Stethoscope, Wallet, WifiOff, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'
import { cn } from '@/presentation/cn'
import { useOnlineStatus } from '@/presentation/hooks/useOnlineStatus'
import { BadgeProtegido } from '@/presentation/components/BadgeProtegido'
import { SyncStatusBadge } from '@/presentation/components/SyncStatusBadge'
import { useSyncStatus } from '@/presentation/hooks/useSyncStatus'
import { MigrarPlanilha } from '@/presentation/features/auth/MigrarPlanilha'

const navItemClass = 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all'

const ctaClass = 'inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2 text-sm font-bold text-white shadow-md shadow-brand-600/40 transition-all hover:shadow-lg hover:shadow-brand-600/50'

/** Item de navegação (aba no desktop, linha do menu no celular). */
function ItemNavegacao({
  to,
  label,
  icon: Icon,
  end,
  mobile = false,
}: {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  mobile?: boolean
}) {
  const ehLogin = to === '/login'
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          ehLogin ? ctaClass : navItemClass,
          mobile && 'w-full',
          mobile && (ehLogin ? 'justify-center' : 'justify-start'),
          ehLogin
            ? undefined
            : isActive
              ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
              : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700',
        )
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </NavLink>
  )
}

export function AppLayout() {
  const { status, logout, isModoLocal } = useAuth()
  const online = useOnlineStatus()
  const sync = useSyncStatus()
  const { pathname } = useLocation()
  const [menuAberto, setMenuAberto] = useState(false)

  // No celular o menu fecha ao navegar e com a tecla Esc.
  useEffect(() => {
    setMenuAberto(false)
  }, [pathname])

  useEffect(() => {
    if (!menuAberto) return
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuAberto(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [menuAberto])
  // Modo local (planilha persistida sem token válido) também libera a
  // navegação completa — as páginas exibem os dados do cache.
  const hasWorkspaceSession = status === 'authenticated' || status === 'local'

  const navItems = hasWorkspaceSession
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
    <div className="flex min-h-screen flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/75 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
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
                bloqueado={status === 'bloqueado'}
                onSync={() => void sync.syncNow()}
              />
              <BadgeProtegido />
              {isModoLocal ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                  title="Os dados estão salvos apenas neste navegador"
                >
                  <HardDrive className="h-3.5 w-3.5" aria-hidden />
                  Neste navegador
                </span>
              ) : null}
            </div>

            {/* Abaixo de md a navegação vira um menu suspenso (hambúrguer). */}
            <button
              type="button"
              onClick={() => setMenuAberto((aberto) => !aberto)}
              aria-expanded={menuAberto}
              aria-controls="menu-mobile"
              aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 md:hidden"
            >
              {menuAberto ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Menu className="h-4 w-4" aria-hidden />
              )}
              Menu
            </button>

            <nav aria-label="Navegação principal" className="hidden md:block">
              <ul className="flex flex-wrap items-center gap-1">
                {navItems.map((item) => (
                  <li key={item.to}>
                    <ItemNavegacao {...item} />
                  </li>
                ))}

                {hasWorkspaceSession ? (
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

                {status === 'local' && !isModoLocal ? (
                  <li>
                    <NavLink to="/login" className={ctaClass}>
                      <LogIn className="h-4 w-4" aria-hidden />
                      Entrar
                    </NavLink>
                  </li>
                ) : null}
              </ul>
            </nav>
          </div>

          {menuAberto ? (
            <nav
              id="menu-mobile"
              aria-label="Navegação principal"
              className="mt-3 border-t border-slate-200 pt-3 md:hidden"
            >
              <ul className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <li key={item.to}>
                    <ItemNavegacao {...item} mobile />
                  </li>
                ))}

                {hasWorkspaceSession ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAberto(false)
                        void logout()
                      }}
                      className={cn(
                        navItemClass,
                        'w-full justify-start border border-slate-200 text-slate-600 hover:bg-brand-50 hover:text-brand-700',
                      )}
                    >
                      <LogOut className="h-4 w-4" aria-hidden />
                      Sair
                    </button>
                  </li>
                ) : null}

                {status === 'local' && !isModoLocal ? (
                  <li>
                    <ItemNavegacao to="/login" label="Entrar" icon={LogIn} end={false} mobile />
                  </li>
                ) : null}
              </ul>
            </nav>
          ) : null}
        </div>
      </header>

      {!online && !isModoLocal ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800"
        >
          <WifiOff className="h-4 w-4" aria-hidden />
          Modo offline — exibindo o último estado salvo da carteira.
        </div>
      ) : null}

      {/* Oferta de migração (§6.6): no shell para aparecer em qualquer tela após o upgrade. */}
      <MigrarPlanilha />

      <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 overflow-x-clip px-4 py-8 focus:outline-none">
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
