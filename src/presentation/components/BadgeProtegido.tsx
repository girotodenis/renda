import { Lock, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { cn } from '@/presentation/cn'
import { Alert } from '@/presentation/components/Alert'
import { Modal } from '@/presentation/components/Modal'

/**
 * Indicador de cofre cifrado no cabeçalho (§5.6 / §6.4).
 *
 * Só aparece quando o banco ativo está cifrado. A ação "Bloquear agora" **sempre
 * pede confirmação** (decisão 12) porque ela descarta o cache de abas em claro e
 * esquece a chave: sem a senha o usuário não volta aos dados.
 */
export function BadgeProtegido() {
  const { criptografiaDoBanco, status, isBusy, bloquearBanco, clearError } = useAuth()
  const [confirmando, setConfirmando] = useState(false)
  const [pendentes, setPendentes] = useState<number | null>(null)

  if (criptografiaDoBanco !== 'total') return null

  const bloqueado = status === 'bloqueado'

  function abrir() {
    clearError()
    setPendentes(null)
    setConfirmando(true)
  }

  async function confirmar() {
    const resultado = await bloquearBanco()
    setPendentes(resultado.pendentes)
  }

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

      <button
        type="button"
        onClick={abrir}
        disabled={bloqueado || isBusy}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
        Bloquear
      </button>

      <Modal
        open={confirmando}
        onClose={() => setConfirmando(false)}
        titulo="Bloquear o banco agora?"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            A chave será esquecida e o cache de abas será apagado deste dispositivo. Para voltar aos
            dados, a senha será pedida novamente.
          </p>

          {pendentes !== null ? (
            <Alert variant={pendentes > 0 ? 'info' : 'success'}>
              {pendentes > 0
                ? `Criptografia bloqueada. Há ${pendentes === 1 ? '1 alteração pendente' : `${pendentes} alterações pendentes`} que serão enviadas após o desbloqueio.`
                : 'Criptografia bloqueada.'}
            </Alert>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              {pendentes === null ? 'Cancelar' : 'Fechar'}
            </button>
            {pendentes === null ? (
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LockKeyhole className="h-4 w-4" aria-hidden />
                Bloquear agora
              </button>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  )
}
