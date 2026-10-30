import { useCallback, useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { Modal } from '@/presentation/components/Modal'
import { OperacaoForm } from '@/presentation/features/operacoes/OperacaoForm'
import { toOperacaoPayload } from '@/presentation/features/operacoes/operacaoSchema'
import type { OperacaoFormOutput } from '@/presentation/features/operacoes/operacaoSchema'
import { categoriaLabel } from '@/domain/categoria'
import { operacoesRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import type { CategoriaAtivo } from '@/domain/entities'
import type { TickerConhecido } from '@/domain/tickers'
import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'

interface NovaOperacaoModalProps {
  /**
   * Categoria pré-selecionada e **travada** no formulário. Quando `null`, o
   * modal permanece fechado.
   */
  categoria: CategoriaAtivo | null
  /** Fecha o modal (Esc, backdrop ou botão fechar). */
  onClose: () => void
  /** Recarrega os dados do dashboard após registrar a operação. */
  onSaved: () => Promise<void>
  /** Tickers da carteira (priorizados no autocomplete do ticker). */
  tickersConhecidos?: readonly TickerConhecido[]
}

/**
 * Modal de cadastro de operação a partir de uma categoria do dashboard.
 *
 * A categoria é pré-preenchida e bloqueada (`travarCategoria`), de modo que o
 * usuário não pode alterá-la — o lançamento fica vinculado à tabela de origem.
 * Após salvar, o consolidado é recalculado, um snapshot é registrado e o
 * dashboard é recarregado (`onSaved`).
 */
export function NovaOperacaoModal({
  categoria,
  onClose,
  onSaved,
  tickersConhecidos,
}: NovaOperacaoModalProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (values: OperacaoFormOutput) => {
      setError(null)
      if (!workspace) {
        setError('Configure uma planilha antes de lançar operações.')
        return
      }
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }

      const context: RepositoryContext = {
        accessToken: token,
        spreadsheetId: workspace.spreadsheetId,
      }

      setIsSaving(true)
      try {
        await operacoesRepo.append(context, {
          id: operacoesRepo.newId(),
          ...toOperacaoPayload(values),
        })
        await sincronizarConsolidadoESnapshot(context)
        await onSaved()
        onClose()
      } catch (saveError) {
        setError(describeSheetsError(saveError))
      } finally {
        setIsSaving(false)
      }
    },
    [workspace, ensureAccessToken, onSaved, onClose],
  )

  return (
    <Modal
      open={categoria !== null}
      onClose={onClose}
      titulo={categoria ? `Nova operação · ${categoriaLabel(categoria)}` : 'Nova operação'}
      className="max-w-3xl"
    >
      {categoria ? (
        <div className="space-y-4">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <OperacaoForm
            key={categoria}
            categoriaPadrao={categoria}
            travarCategoria
            tickersConhecidos={tickersConhecidos}
            isSaving={isSaving}
            onSubmit={handleSubmit}
            onCancel={onClose}
          />
        </div>
      ) : null}
    </Modal>
  )
}
