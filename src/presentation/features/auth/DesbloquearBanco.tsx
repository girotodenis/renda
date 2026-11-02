import { HardDrive, Loader2, Lock, Unlock } from 'lucide-react'
import { useState } from 'react'
import { isCriptografiaSuportada } from '@/infrastructure/cripto/webCrypto'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { CampoSenha } from '@/presentation/components/CampoSenha'

/**
 * Atraso entre tentativas: 0s, 1s, 2s e depois 5s (§6.8).
 *
 * Não há bloqueio permanente (o usuário pode ter esquecido qual das senhas
 * usou); o atraso só desencoraja tentativa em massa, e o PBKDF2 com 600.000
 * iterações já domina o custo de cada tentativa.
 */
const ATRASOS_TENTATIVA_MS = [0, 1000, 2000, 5000]

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Tela de bloqueio do banco cifrado (§6.8) — **página**, não modal.
 *
 * Fica no lugar de qualquer conteúdo de dados (`RouteGuards`) justamente para o
 * cache em claro nunca aparecer antes da chave. Mostra o nome do banco e
 * funciona igual online e offline (no offline a conferência usa o verificador
 * local).
 */
export function DesbloquearBanco() {
  const {
    workspace,
    error,
    isBusy,
    isModoLocal,
    clearError,
    desbloquearBanco,
    esquecerBanco,
    usarModoLocal,
  } = useAuth()
  const [senha, setSenha] = useState('')
  const [tentativas, setTentativas] = useState(0)
  const [aguardando, setAguardando] = useState(false)

  // Web Crypto exige HTTPS (ou localhost): sem ele não há como derivar a chave.
  const suportado = isCriptografiaSuportada()
  const pendente = isBusy || aguardando
  const podeEnviar = suportado && !pendente && senha.trim().length > 0

  async function enviar() {
    if (!podeEnviar) return

    const atraso = ATRASOS_TENTATIVA_MS[Math.min(tentativas, ATRASOS_TENTATIVA_MS.length - 1)]
    setTentativas((total) => total + 1)
    clearError()

    if (atraso > 0) {
      setAguardando(true)
      await esperar(atraso)
      setAguardando(false)
    }

    await desbloquearBanco(senha)
  }

  return (
    <section className="mx-auto max-w-md space-y-6" aria-labelledby="desbloquear-titulo">
      <header className="space-y-2 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <h1 id="desbloquear-titulo" className="text-2xl font-semibold text-slate-900">
          {workspace?.title ?? 'Banco protegido'}
        </h1>
        <p className="text-sm text-slate-500">
          Este banco está criptografado. Informe a chave para continuar.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {suportado ? null : (
          <Alert variant="error">
            Seu navegador não suporta criptografia neste contexto (é necessário HTTPS).
          </Alert>
        )}
        {error ? <Alert variant="error">{error}</Alert> : null}

        <CampoSenha
          id="senha-desbloqueio"
          valor={senha}
          aoMudar={setSenha}
          autoFocus
          desabilitado={!suportado || pendente}
          aoEnviar={() => void enviar()}
        />

        <button
          type="button"
          onClick={() => void enviar()}
          disabled={!podeEnviar}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendente ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Unlock className="h-4 w-4" aria-hidden />
          )}
          Desbloquear
        </button>

        <p className="text-center text-xs text-slate-500">
          Sua senha não é armazenada. Sem ela, os dados não podem ser recuperados.
        </p>
      </div>

      <div className="space-y-2 text-center">
        <button
          type="button"
          onClick={esquecerBanco}
          disabled={isBusy}
          className="text-xs font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Esquecer este banco neste dispositivo
        </button>

        {isModoLocal ? null : (
          <div>
            <button
              type="button"
              onClick={() => void usarModoLocal()}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-brand-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              <HardDrive className="h-3.5 w-3.5" aria-hidden />
              Usar sem Google
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
