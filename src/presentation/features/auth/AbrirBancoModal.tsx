import { Database, Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PlanilhaExistente } from '@/domain/workspace'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { Modal } from '@/presentation/components/Modal'

interface AbrirBancoModalProps {
  /** Controla a visibilidade do modal. */
  open: boolean
  /** Fecha o modal (Esc, backdrop ou botão fechar). */
  onClose: () => void
}

const formatador = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

/** Data legível do último modificado (`null` quando a origem não informa). */
function formatarData(iso: string | null | undefined): string | null {
  if (!iso) return null
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? null : formatador.format(data)
}

/**
 * Lista os bancos já existentes na origem ativa (arquivos JSON no Drive ou
 * planilhas visíveis para o app) e abre o escolhido. O Google Picker, quando
 * disponível, fica como ação secundária para uma planilha ainda desconhecida.
 */
export function AbrirBancoModal({ open, onClose }: AbrirBancoModalProps) {
  const { listarBancos, abrirBancoPorId, abrirPlanilhaNoPicker, isPickerConfigured, isBusy, error } =
    useAuth()
  const [bancos, setBancos] = useState<PlanilhaExistente[]>([])
  const [carregando, setCarregando] = useState(false)
  const [idAbrindo, setIdAbrindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      setBancos(await listarBancos())
    } finally {
      setCarregando(false)
    }
  }, [listarBancos])

  useEffect(() => {
    if (!open) {
      setBancos([])
      setIdAbrindo(null)
      return
    }
    void carregar()
  }, [open, carregar])

  async function abrir(spreadsheetId: string) {
    setIdAbrindo(spreadsheetId)
    try {
      await abrirBancoPorId(spreadsheetId)
      onClose()
    } finally {
      setIdAbrindo(null)
    }
  }

  async function abrirComPicker() {
    await abrirPlanilhaNoPicker()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} titulo="Abrir banco de dados" className="max-w-xl">
      <div className="space-y-4">
        {error ? (
          <Alert variant="error" title="Não foi possível listar os bancos">
            {error}
          </Alert>
        ) : null}

        {carregando ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando bancos do Drive…
          </p>
        ) : bancos.length === 0 ? (
          <p className="text-sm text-slate-600">
            Nenhum banco de dados encontrado. Crie um novo com a opção{' '}
            <strong className="font-semibold text-slate-900">Criar banco de dados</strong>.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200">
            {bancos.map((banco) => {
              const quando = formatarData(banco.modificadaEm)
              const abrindo = idAbrindo === banco.spreadsheetId
              return (
                <li key={banco.spreadsheetId}>
                  <button
                    type="button"
                    onClick={() => void abrir(banco.spreadsheetId)}
                    disabled={isBusy || idAbrindo !== null}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {abrindo ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-600" aria-hidden />
                    ) : (
                      <Database className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {banco.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {quando ? `Modificado em ${quando}` : 'Banco de dados no Google Drive'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void carregar()}
            disabled={carregando || isBusy}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {carregando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="h-4 w-4" aria-hidden />
            )}
            Atualizar lista
          </button>

          {isPickerConfigured ? (
            <button
              type="button"
              onClick={() => void abrirComPicker()}
              disabled={isBusy || carregando}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Procurar planilha no Drive…
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
