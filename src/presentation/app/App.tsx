import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/presentation/app/layout/AppLayout'
import { AuthProvider } from '@/presentation/app/providers/AuthProvider'
import { LayoutProvider } from '@/presentation/app/providers/LayoutProvider'
import { ProtectedRoute, PublicOnlyRoute } from '@/presentation/app/routes/RouteGuards'
import { ErrorBoundary } from '@/presentation/components/ErrorBoundary'
import { LoginPage } from '@/presentation/features/auth/LoginPage'
import { ConfiguracoesPage } from '@/presentation/features/configuracoes/ConfiguracoesPage'
import { DashboardPage } from '@/presentation/features/dashboard/DashboardPage'
import { DiagnosticoPage } from '@/presentation/features/diagnostico/DiagnosticoPage'
import { EventosPage } from '@/presentation/features/eventos/EventosPage'
import { HomePage } from '@/presentation/features/home/HomePage'
import { ImportarB3Page } from '@/presentation/features/importar/ImportarB3Page'
import { OperacoesPage } from '@/presentation/features/operacoes/OperacoesPage'
import { ProventosPage } from '@/presentation/features/proventos/ProventosPage'
import { RebalanceamentoPage } from '@/presentation/features/rebalanceamento/RebalanceamentoPage'

export function App() {
  return (
    <BrowserRouter
      basename={import.meta.env.BASE_URL.replace(/\/$/, '')}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <LayoutProvider>
        <AuthProvider>
          <ErrorBoundary title="Algo deu errado">
            <Routes>
              <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <LoginPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/operacoes"
                element={
                  <ProtectedRoute>
                    <OperacoesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/proventos"
                element={
                  <ProtectedRoute>
                    <ProventosPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/eventos"
                element={
                  <ProtectedRoute>
                    <EventosPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/importar-b3"
                element={
                  <ProtectedRoute>
                    <ImportarB3Page />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rebalanceamento"
                element={
                  <ProtectedRoute>
                    <RebalanceamentoPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/diagnostico"
                element={
                  <ProtectedRoute>
                    <DiagnosticoPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes"
                element={
                  <ProtectedRoute>
                    <ConfiguracoesPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ErrorBoundary>
        </AuthProvider>
      </LayoutProvider>
    </BrowserRouter>
  )
}
