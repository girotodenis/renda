import { AlertTriangle, FilePlus2, FolderOpen, Loader2, LockKeyhole } from 'lucide-react'
import { useRef, useState } from 'react'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import { criarSessao } from '@/infrastructure/cripto/envelope'
import { criptografiaDisponivel } from '@/infrastructure/sheets/gatewayRouter'
import type { PlanilhaExistente } from '@/domain/workspace'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { CampoSenha } from '@/presentation/components/CampoSenha'
import { Modal } from '@/presentation/components/Modal'
import { AbrirBancoModal } from './AbrirBancoModal'

const DEFAULT_TITLE = 'Minhas Ações — Carteira'

/** Mensagem única de senha em branco (§6.7) — não há mínimo de tamanho. */
const MSG_SENHA_VAZIA =
  'Informe uma senha (não há mínimo de tamanho, mas não pode ficar em branco).'

/**
 * Etapa pós-login: o usuário cria o banco padrão (abas do schema) ou abre um banco já
 * existente escolhendo-o em uma **lista** dos bancos do Drive (RF02).
 *
 * Ao criar com um nome já existente, pergunta se o usuário quer editar o banco
 * existente (Sim) ou criar um novo mesmo assim (Não) — preservando a senha já
 * derivada, para não pedir tudo de novo.
 *
 * Com o checkbox "Criar banco criptografado" o arquivo nasce cifrado
 * (`PLANO_CRIPTOGRAFIA.md` §6.3): a chave é derivada **no clique** (PBKDF2 é
 * caro) e o banco já entra desbloqueado nesta sessão.
 */
export function WorkspaceSetup() {
  const { criarBanco, abrirBancoPorId, isBusy, error } = useAuth()
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [duplicada, setDuplicada] = useState<PlanilhaExistente | null>(null)
  const [listaAberta, setListaAberta] = useState(false)
  const [criptografar, setCriptografar] = useState(false)
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [entendi, setEntendi] = useState(false)
  const [erroSenha, setErroSenha] = useState<string | null>(null)
  const [derivando, setDerivando] = useState(false)

  // Sessão derivada uma única vez: o fluxo de nome duplicado reaproveita a mesma
  // chave em vez de exigir a senha de novo.
  const sessaoRef = useRef<SessaoCripto | null>(null)

  const disponivel = criptografiaDisponivel()
  const senhaPreenchida = senha.trim().length > 0
  const senhasConferem = confirmacao === senha
  const criptoValida = !criptografar || (senhaPreenchida && senhasConferem && entendi)
  const ocupado = isBusy || derivando
  const canCreate = !ocupado && title.trim().length > 0 && criptoValida

  function alterarSenha(valor: string) {
    setSenha(valor)
    // Qualquer edição invalida a chave já derivada.
    sessaoRef.current = null
  }

  function alterarConfirmacao(valor: string) {
    setConfirmacao(valor)
    sessaoRef.current = null
  }

  function alternarCriptografia(marcado: boolean) {
    setCriptografar(marcado)
    setErroSenha(null)
    sessaoRef.current = null
    if (!marcado) {
      setSenha('')
      setConfirmacao('')
      setEntendi(false)
    }
  }

  /** Deriva a chave só quando a criação acontece de fato (nunca ao digitar). */
  async function obterSessao(): Promise<SessaoCripto | null> {
    if (!criptografar) return null
    if (sessaoRef.current) return sessaoRef.current
    if (!senhaPreenchida) {
      setErroSenha(MSG_SENHA_VAZIA)
      return null
    }
    if (!senhasConferem) {
      setErroSenha('As senhas não conferem.')
      return null
    }
    if (!entendi) return null

    setErroSenha(null)
    setDerivando(true)
    try {
      const sessao = await criarSessao(senha)
      sessaoRef.current = sessao
      return sessao
    } catch (erroDerivacao) {
      setErroSenha(
        erroDerivacao instanceof Error && erroDerivacao.message.length > 0
          ? erroDerivacao.message
          : 'Não foi possível preparar a criptografia.',
      )
      return null
    } finally {
      setDerivando(false)
    }
  }

  async function handleCriar() {
    setErroSenha(null)
    const sessao = await obterSessao()
    if (criptografar && !sessao) return
    const resultado = await criarBanco(title, sessao ? { chave: sessao } : undefined)
    if (resultado.status === 'duplicate') setDuplicada(resultado.existente)
  }

  async function editarExistente() {
    const alvo = duplicada
    setDuplicada(null)
    // A chave derivada era para o banco novo; abrir outro banco a descarta.
    sessaoRef.current = null
    if (alvo) await abrirBancoPorId(alvo.spreadsheetId)
  }

  async function criarNova() {
    setDuplicada(null)
    const sessao = await obterSessao()
    if (criptografar && !sessao) return
    await criarBanco(title, { force: true, ...(sessao ? { chave: sessao } : {}) })
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

      {disponivel ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={criptografar}
              onChange={(event) => alternarCriptografia(event.target.checked)}
              disabled={ocupado}
              className="mt-0.5 accent-brand-600"
            />
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole className="h-4 w-4 text-slate-500" aria-hidden />
              Criar banco criptografado
            </span>
          </label>

          {criptografar ? (
            <div className="space-y-3">
              <CampoSenha
                valor={senha}
                aoMudar={alterarSenha}
                rotulo="Senha"
                autoComplete="new-password"
                desabilitado={ocupado}
                erro={senha.length > 0 && !senhaPreenchida ? MSG_SENHA_VAZIA : erroSenha}
              />
              <CampoSenha
                valor={confirmacao}
                aoMudar={alterarConfirmacao}
                rotulo="Confirmar senha"
                autoComplete="new-password"
                desabilitado={ocupado}
                erro={confirmacao.length > 0 && !senhasConferem ? 'As senhas não conferem.' : null}
              />

              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Sem a senha, os dados são irrecuperáveis. Você poderá exportar um backup{' '}
                  <code className="rounded bg-amber-100 px-1">.ods</code> nas Configurações — esse
                  arquivo é gerado sem criptografia.
                </span>
              </p>

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={entendi}
                  onChange={(event) => setEntendi(event.target.checked)}
                  disabled={ocupado}
                  className="mt-0.5 accent-brand-600"
                />
                <span>Entendi que não há recuperação</span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void handleCriar()}
          disabled={!canCreate}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ocupado ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FilePlus2 className="h-4 w-4" aria-hidden />
          )}
          Criar banco de dados
        </button>

        <button
          type="button"
          onClick={() => setListaAberta(true)}
          disabled={ocupado}
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
            disabled={ocupado}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Não, criar nova
          </button>
          <button
            type="button"
            onClick={() => void editarExistente()}
            disabled={ocupado}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ocupado ? (
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
