import { useEffect, useRef } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Modal } from '@/presentation/components/Modal'
import { WorkspaceSetup } from './WorkspaceSetup'

interface TrocarPlanilhaModalProps {
  /** Controla a visibilidade do modal. */
  open: boolean
  /** Fecha o modal (Esc, backdrop ou botão fechar). */
  onClose: () => void
}

/**
 * Modal para trocar o banco ativo: permite criar um banco padrão novo ou abrir
 * outro já existente, reaproveitando o `WorkspaceSetup` da etapa pós-login.
 * Fecha automaticamente quando o banco ativo muda.
 */
export function TrocarPlanilhaModal({ open, onClose }: TrocarPlanilhaModalProps) {
  const { workspace, clearError } = useAuth()
  const spreadsheetIdAoAbrir = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      spreadsheetIdAoAbrir.current = null
      return
    }

    const atual = workspace?.spreadsheetId ?? null
    if (spreadsheetIdAoAbrir.current === null) {
      spreadsheetIdAoAbrir.current = atual
      clearError()
      return
    }

    if (atual !== null && atual !== spreadsheetIdAoAbrir.current) {
      onClose()
    }
  }, [open, workspace, clearError, onClose])

  return (
    <Modal open={open} onClose={onClose} titulo="Trocar banco de dados" className="max-w-xl">
      <p className="mb-4 text-sm text-slate-500">
        Abra outro banco já existente ou crie um novo com as 7 abas do app. Nada é apagado: cada
        banco continua salvo no seu Drive.
      </p>
      <WorkspaceSetup />
    </Modal>
  )
}
