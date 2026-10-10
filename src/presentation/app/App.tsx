import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/app/layout/AppLayout'
import { AuthProvider } from '@/app/providers/AuthProvider'
import { ProtectedRoute, PublicOnlyRoute } from '@/app/routes/RouteGuards'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { DiagnosticoPage } from '@/features/diagnostico/DiagnosticoPage'
import { EventosPage } from '@/features/eventos/EventosPage'
import { HomePage } from '@/features/home/HomePage'
import { ImportarB3Page } from '@/features/importar/ImportarB3Page'
import { OperacoesPage } from '@/features/operacoes/OperacoesPage'
import { ProventosPage } from '@/features/proventos/ProventosPage'
import { RebalanceamentoPage } from '@/features/rebalanceamento/RebalanceamentoPage'

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  )
}
