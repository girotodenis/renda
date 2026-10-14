import { KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { WorkspaceSetup } from '@/presentation/features/auth/WorkspaceSetup'

/**
 * Login OAuth 2.0 com o Google (RF01) e ponto de partida da configuração da
 * planilha (RF02). Quando `VITE_GOOGLE_CLIENT_ID` está ausente, exibe um estado
 * de erro claro em vez de quebrar em runtime.
 */
export function LoginPage() {
  const { login, status, workspace, isConfigured, error } = useAuth()

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <LogIn className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold text-slate-900">Entrar com o Google</h1>
        <p className="text-sm text-slate-500">
          Conecte sua conta para acessar a carteira. O token fica apenas neste navegador — nenhum
          dado passa por servidores próprios.
        </p>
      </header>

      {!isConfigured ? (
        <Alert variant="error" title="Configuração do Google ausente">
          Defina a variável de ambiente <code>VITE_GOOGLE_CLIENT_ID</code> no arquivo{' '}
          <code>.env</code>. Consulte o <code>.env.example</code> para o passo a passo de como obter
          o Client ID no Google Cloud Console.
        </Alert>
      ) : null}

      {isConfigured && status === 'unauthenticated' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {error ? <Alert variant="error">{error}</Alert> : null}

          <button
            type="button"
            onClick={() => void login()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Entrar com Google
          </button>

          <p className="flex items-start gap-2 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            Permissões mínimas solicitadas (RF03): ler/editar planilhas e acessar apenas os arquivos
            que você escolher no Drive.
          </p>
        </div>
      ) : null}

      {isConfigured && status === 'local' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {error ? <Alert variant="error">{error}</Alert> : null}

          <Alert variant="info" title="Modo local">
            Você está vendo os dados salvos neste navegador. Entre novamente com o Google para
            sincronizar com a sua planilha.
          </Alert>

          <button
            type="button"
            onClick={() => void login()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Entrar com Google
          </button>
        </div>
      ) : null}

      {isConfigured && status === 'loading' ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />
          Conectando ao Google...
        </div>
      ) : null}

      {isConfigured && status === 'authenticated' && !workspace ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Alert variant="success" title="Login concluído">
            Agora escolha a planilha que servirá de base de dados para a sua carteira.
          </Alert>
          <WorkspaceSetup />
        </div>
      ) : null}

      {!isConfigured ? (
        <p className="flex items-start justify-center gap-2 text-xs text-slate-400">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Nenhum segredo é comitado: as credenciais vêm de variáveis de ambiente do Vite.
        </p>
      ) : null}
    </section>
  )
}
