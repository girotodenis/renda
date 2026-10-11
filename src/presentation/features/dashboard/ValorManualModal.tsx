import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { FormField, inputClassName } from '@/presentation/components/FormField'
import { Modal } from '@/presentation/components/Modal'
import { definirValorManualTicker } from '@/application/operacoes'
import { categoriaLabel } from '@/domain/categoria'
import { STATUS_COTACAO_LABELS } from '@/domain/cotacoes'
import type { CotacaoResolvida } from '@/domain/cotacoes'
import { formatMoneyInput, parseBRL, toCentavos } from '@/domain/money'
import { formatarCentavos } from '@/presentation/features/dashboard/formatters'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import type { CategoriaAtivo } from '@/domain/entities'
import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'

/** Alvo da marcação manual: ticker + categoria do ativo selecionado. */
export interface AlvoValorManual {
  ticker: string
  categoria: CategoriaAtivo
}

interface ValorManualModalProps {
  /** Ativo alvo; `null` mantém o modal fechado. */
  alvo: AlvoValorManual | null
  /** Marcação manual já registrada (centavos) — pré-preenche o campo. */
  valorManualAtual?: number | null
  /** Cotação resolvida atual (contexto exibido no modal). */
  cotacaoAtual?: CotacaoResolvida | null
  /** Fecha o modal (Esc, backdrop ou botão fechar). */
  onClose: () => void
  /** Recarrega os dados do dashboard após salvar. */
  onSaved: () => Promise<void>
}

/**
 * Modal de **marcação manual do valor atual** de um ativo de Renda Fixa ou
 * Tesouro Direto (RF19).
 *
 * O valor informado é gravado na operação mais recente do ticker
 * (`Valor Bruto Atual`) por `definirValorManualTicker` e passa a ser o preço
 * usado no cálculo (ou uma estimativa quando não informado).
 * Como a sincronização do `Consolidado` nunca reescreve a aba `Operacoes`, o
 * valor informado pelo usuário **não é apagado** por falhas de integração
 * (RNF04).
 */
export function ValorManualModal({
  alvo,
  valorManualAtual,
  cotacaoAtual,
  onClose,
  onSaved,
}: ValorManualModalProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [valor, setValor] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reinicia o formulário a cada novo alvo / valor registrado.
  useEffect(() => {
    if (!alvo) return
    setValor(valorManualAtual != null ? formatMoneyInput(valorManualAtual) : '')
    setError(null)
    setIsSaving(false)
  }, [alvo, valorManualAtual])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!alvo) return

    const reais = parseBRL(valor)
    if (reais === null || reais <= 0) {
      setError('Informe um valor atual válido e maior que zero.')
      return
    }

    setError(null)
    if (!workspace) {
      setError('Configure uma planilha antes de informar valores.')
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
      await definirValorManualTicker(context, alvo.ticker, toCentavos(reais))
      await sincronizarConsolidadoESnapshot(context)
      await onSaved()
      onClose()
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const titulo = alvo ? (
    <span className="flex flex-wrap items-center gap-2">
      Valor atual · <span className="font-mono">{alvo.ticker}</span>
    </span>
  ) : (
    'Valor atual'
  )

  return (
    <Modal open={alvo !== null} onClose={onClose} titulo={titulo} className="max-w-xl">
      {alvo ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <p className="text-sm text-slate-600">
            Informe o valor atual de mercado de{' '}
            <span className="font-mono font-medium text-slate-900">{alvo.ticker}</span> (
            {categoriaLabel(alvo.categoria)}). Esse valor é usado sempre que a atualização
            automática não estiver disponível e{' '}
            <strong className="font-semibold text-slate-900">não é alterado</strong> por falhas de
            integração.
          </p>

          {cotacaoAtual && !cotacaoAtual.usandoFallback ? (
            <p className="text-xs text-slate-500">
              Cotação atual: {formatarCentavos(cotacaoAtual.precoAtual)} ·{' '}
              {STATUS_COTACAO_LABELS[cotacaoAtual.status]}
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Ainda não há cotação disponível para este ativo.
            </p>
          )}

          {error ? <Alert variant="error">{error}</Alert> : null}

          <FormField
            htmlFor="valor-manual"
            label="Valor atual (R$)"
            hint="Cotação por unidade do título."
          >
            <input
              id="valor-manual"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className={inputClassName}
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              autoFocus
            />
          </FormField>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Salvar valor
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}
