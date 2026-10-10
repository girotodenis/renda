import { FilePlus2, Loader2, Search } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'

const DEFAULT_TITLE = 'Minhas Ações — Carteira'

/**
 * Etapa pós-login: o usuário cria a planilha padrão (5 abas) ou seleciona uma
 * planilha existente no Drive via Google Picker (RF02).
 */
export function WorkspaceSetup() {
  const { criarPlanilha, selecionarPlanilha, isBusy, isPickerConfigured, error } = useAuth()
  const [title, setTitle] = useState(DEFAULT_TITLE)

  const canCreate = !isBusy && title.trim().length > 0

  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="error" title="Não foi possível concluir">
          {error}
        </Alert>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="spreadsheet-title" className="block text-sm font-medium text-slate-700">
          Nome da nova planilha
        </label>
        <input
          id="spreadsheet-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          placeholder={DEFAULT_TITLE}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void criarPlanilha(title)}
          disabled={!canCreate}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FilePlus2 className="h-4 w-4" aria-hidden />
          )}
          Criar planilha padrão
        </button>

        <button
          type="button"
          onClick={() => void selecionarPlanilha()}
          disabled={isBusy || !isPickerConfigured}
          title={isPickerConfigured ? undefined : 'Requer VITE_GOOGLE_PICKER_API_KEY'}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
          Selecionar planilha existente
        </button>
      </div>

      {!isPickerConfigured ? (
        <Alert variant="info" title="Seleção de planilha indisponível">
          Defina <code>VITE_GOOGLE_PICKER_API_KEY</code> no arquivo <code>.env</code> para escolher
          uma planilha existente. A criação de uma planilha nova já está disponível.
        </Alert>
      ) : null}
    </div>
  )
}
