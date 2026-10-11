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
 * Modal para trocar a planilha ativa: permite criar uma planilha padrão nova ou
 * selecionar outra planilha existente no Drive, reaproveitando o `WorkspaceSetup`
 * da etapa pós-login. Fecha automaticamente quando a planilha ativa muda.
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
    <Modal open={open} onClose={onClose} titulo="Trocar planilha" className="max-w-xl">
      <p className="mb-4 text-sm text-slate-500">
        Escolha outra planilha existente no Drive ou crie uma nova planilha padrão com as 5 abas.
        Nada é apagado: cada planilha continua salva no seu Drive.
      </p>
      <WorkspaceSetup />
    </Modal>
  )
}
