import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Alert } from '@/presentation/components/Alert'
import { CampoSenha } from '@/presentation/components/CampoSenha'
import { Modal } from '@/presentation/components/Modal'

/** Props do modal de senha (casca reutilizável de qualquer operação com chave). */
export interface ModalSenhaProps {
  open: boolean
  onClose: () => void
  /** Título do modal (nome da operação ou do banco). */
  titulo: ReactNode
  /** Aviso/consequência exibido acima dos campos. */
  descricao?: ReactNode
  /** Rótulo do botão principal ("Desbloquear", "Criptografar"...). */
  rotuloConfirmar: string
  /** Recebe a senha digitada (`''` quando `pedirSenha` é `false`). */
  onConfirmar: (senha: string) => void | Promise<void>
  /** Erro da operação (senha errada, falha de rede). */
  erro?: string | null
  /** `true` enquanto a operação roda (PBKDF2/rede): spinner e botões travados. */
  pending?: boolean
  /**
   * Campos extras do formulário (confirmação, "Entendi que não há
   * recuperação", botão de backup `.ods`). Ficam entre a senha e as ações.
   */
  children?: ReactNode
  rotuloCancelar?: string
  rotuloSenha?: string
  /** `false` em modais só de confirmação ("Bloquear agora"). */
  pedirSenha?: boolean
  /** Desabilita o botão principal (ex.: "Entendi" ainda não marcado). */
  confirmarDesabilitado?: boolean
  className?: string
}

/**
 * Casca de modal para operações que pedem a chave (§6.8).
 *
 * Centraliza o que não pode variar entre as operações: senha com autofocus,
 * `Enter` enviando, spinner durante a derivação, erro e as ações
 * cancelar/confirmar. Quem usa decide os textos e os campos extras — assim
 * abrir banco, ativar/desativar criptografia e bloquear ficam consistentes.
 */
export function ModalSenha({
  open,
  onClose,
  titulo,
  descricao,
  rotuloConfirmar,
  onConfirmar,
  erro,
  pending = false,
  children,
  rotuloCancelar = 'Cancelar',
  rotuloSenha = 'Senha',
  pedirSenha = true,
  confirmarDesabilitado = false,
  className,
}: ModalSenhaProps) {
  const [senha, setSenha] = useState('')

  // Cada abertura começa com o campo limpo (a senha não fica em memória à toa).
  useEffect(() => {
    if (!open) setSenha('')
  }, [open])

  function confirmar() {
    if (pending || confirmarDesabilitado) return
    void onConfirmar(pedirSenha ? senha : '')
  }

  function aoSubmeter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    confirmar()
  }

  return (
    <Modal open={open} onClose={onClose} titulo={titulo} className={className ?? 'max-w-lg'}>
      <form className="space-y-4" onSubmit={aoSubmeter}>
        {descricao ? <p className="text-sm text-slate-600">{descricao}</p> : null}
        {erro ? <Alert variant="error">{erro}</Alert> : null}

        {pedirSenha ? (
          <CampoSenha
            valor={senha}
            aoMudar={setSenha}
            rotulo={rotuloSenha}
            autoFocus
            desabilitado={pending}
            aoEnviar={confirmar}
          />
        ) : null}

        {children}

        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rotuloCancelar}
          </button>
          <button
            type="submit"
            disabled={pending || confirmarDesabilitado}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {rotuloConfirmar}
          </button>
        </div>
      </form>
    </Modal>
  )
}
