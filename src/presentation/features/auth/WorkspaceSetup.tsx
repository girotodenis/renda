import { FilePlus2, FolderOpen, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { PlanilhaExistente } from '@/domain/workspace'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { Modal } from '@/presentation/components/Modal'
import { AbrirBancoModal } from './AbrirBancoModal'

const DEFAULT_TITLE = 'Minhas Ações — Carteira'

/**
 * Etapa pós-login: o usuário cria o banco padrão (7 abas) ou abre um banco já
 * existente escolhendo-o em uma **lista** dos bancos do Drive (RF02).
 *
 * Ao criar com um nome já existente, pergunta se o usuário quer editar o banco
 * existente (Sim) ou criar um novo mesmo assim (Não).
 */
export function WorkspaceSetup() {
  const { criarBanco, abrirBancoPorId, isBusy, error } = useAuth()
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [duplicada, setDuplicada] = useState<PlanilhaExistente | null>(null)
  const [listaAberta, setListaAberta] = useState(false)

  const canCreate = !isBusy && title.trim().length > 0

  async function handleCriar() {
    const resultado = await criarBanco(title)
    if (resultado.status === 'duplicate') setDuplicada(resultado.existente)
  }

  async function editarExistente() {
    const alvo = duplicada
    setDuplicada(null)
    if (alvo) await abrirBancoPorId(alvo.spreadsheetId)
  }

  async function criarNova() {
    setDuplicada(null)
    await criarBanco(title, { force: true })
  }

  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="error" title="Não foi possível concluir">
          {error}
        </Alert>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="spreadsheet-title" className="block text-sm font-medium text-slate-700">
          Nome do novo banco de dados
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
          onClick={() => void handleCriar()}
          disabled={!canCreate}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FilePlus2 className="h-4 w-4" aria-hidden />
          )}
          Criar banco de dados
        </button>

        <button
          type="button"
          onClick={() => setListaAberta(true)}
          disabled={isBusy}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FolderOpen className="h-4 w-4" aria-hidden />
          Abrir banco existente
        </button>
      </div>

      <AbrirBancoModal open={listaAberta} onClose={() => setListaAberta(false)} />

      <Modal
        open={duplicada !== null}
        onClose={() => setDuplicada(null)}
        titulo="Já existe um banco com esse nome"
        className="max-w-lg"
      >
        <p className="text-sm text-slate-600">
          Você já tem um banco chamado{' '}
          <strong className="font-semibold text-slate-900">{duplicada?.title}</strong> no seu Drive.
          Deseja abrir o banco que já existe ou criar um novo com esse mesmo nome?
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => void criarNova()}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Não, criar nova
          </button>
          <button
            type="button"
            onClick={() => void editarExistente()}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FilePlus2 className="h-4 w-4" aria-hidden />
            )}
            Sim, abrir o existente
          </button>
        </div>
      </Modal>
    </div>
  )
}
