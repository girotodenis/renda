import { AlertTriangle, Download, Loader2, Lock, LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { estadoDoBanco, motivoCriptografiaIndisponivel } from '@/application/criptografia'
import type { EstadoDoBanco } from '@/application/criptografia'
import { exportarPlanilhaOds } from '@/application/exportar'
import { TOKEN_MODO_LOCAL } from '@/domain/armazenamento'
import { useAuth } from '@/presentation/app/providers/authContext'
import { cn } from '@/presentation/cn'
import { Alert } from '@/presentation/components/Alert'
import { CampoSenha } from '@/presentation/components/CampoSenha'
import { ModalSenha } from '@/presentation/components/ModalSenha'
import { Switch } from '@/presentation/components/Switch'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'

/** Modal aberto no card (um por vez). */
type ModalAberto = 'ativar' | 'desativar' | 'bloquear'

/**
 * Card "Segurança do banco" (§5.6, §6.2, §6.4).
 *
 * Mostra o estado **real** do arquivo (magic/abas, relido ao montar) em vez de
 * confiar só no metadado persistido — outro dispositivo pode ter cifrado o
 * banco. O toggle só liga/desliga depois que o usuário confirma num modal:
 * cifrar é irreversível sem a senha e bloquear descarta o cache em claro, então
 * nenhuma das duas ações pode ficar a um clique de distância.
 */
export function SegurancaBancoCard() {
  const {
    workspace,
    status,
    error,
    clearError,
    criptografiaDoBanco,
    ativarCriptografia,
    desativarCriptografia,
    recarregarEstadoCriptografia,
    bloquearBanco,
    ensureAccessToken,
  } = useAuth()

  const tituloId = useId()
  const descricaoId = useId()

  const [info, setInfo] = useState<EstadoDoBanco | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalAberto | null>(null)
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [entendi, setEntendi] = useState(false)
  const [entendiDesativar, setEntendiDesativar] = useState(false)
  const [operando, setOperando] = useState(false)
  const [pendentes, setPendentes] = useState<number | null>(null)
  const [exportando, setExportando] = useState(false)
  const [resultadoBackup, setResultadoBackup] = useState<string | null>(null)
  const [erroBackup, setErroBackup] = useState<string | null>(null)

  // Metadado do provider lido dentro de um efeito: um ref evita que a
  // sincronização do workspace recrie `lerEstado` e dispare leituras em série.
  const criptografiaConhecidaRef = useRef(criptografiaDoBanco)
  criptografiaConhecidaRef.current = criptografiaDoBanco

  const id = workspace?.spreadsheetId ?? null

  /** Lê o estado real do arquivo/abas (silencioso em falha: mantém o anterior). */
  const lerEstado = useCallback(async (): Promise<EstadoDoBanco | null> => {
    if (!id) return null
    try {
      const token = await ensureAccessToken()
      const resultado = await estadoDoBanco({
        accessToken: token ?? TOKEN_MODO_LOCAL,
        spreadsheetId: id,
      })
      setInfo(resultado)
      if (criptografiaConhecidaRef.current !== resultado.estado) {
        // Só relê o workspace quando o metadado está realmente defasado.
        void recarregarEstadoCriptografia()
      }
      return resultado
    } catch {
      return null
    }
  }, [ensureAccessToken, id, recarregarEstadoCriptografia])

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    void lerEstado().finally(() => {
      if (!cancelado) setCarregando(false)
    })
    return () => {
      cancelado = true
    }
  }, [lerEstado])

  const cifrado = (info?.estado ?? criptografiaDoBanco) === 'total'
  const bloqueado = status === 'bloqueado' || Boolean(info?.bloqueado)
  const rotuloEstado = !cifrado ? 'Sem criptografia' : bloqueado ? 'Bloqueado' : 'Arquivo criptografado'
  const motivo = motivoCriptografiaIndisponivel()
  const ocupado = operando

  const senhaPreenchida = senha.trim().length > 0
  const confirmacaoConfere = confirmacao === senha
  const ativacaoValida = senhaPreenchida && confirmacaoConfere && entendi
  const erroConfirmacao =
    confirmacao.length > 0 && !confirmacaoConfere ? 'As senhas não conferem.' : null

  function fecharModal() {
    setModal(null)
    setSenha('')
    setConfirmacao('')
    setEntendi(false)
    setEntendiDesativar(false)
    setPendentes(null)
    setResultadoBackup(null)
    setErroBackup(null)
    clearError()
  }

  function abrirModal(alvo: ModalAberto) {
    clearError()
    setAviso(null)
    setPendentes(null)
    setSenha('')
    setConfirmacao('')
    setEntendi(false)
    setEntendiDesativar(false)
    setResultadoBackup(null)
    setErroBackup(null)
    setModal(alvo)
  }

  /** O toggle só abre o modal: a alteração real acontece na confirmação. */
  function alternar(valor: boolean) {
    if (motivo !== null) return
    abrirModal(valor ? 'ativar' : 'desativar')
  }

  async function confirmarAtivacao(senhaDigitada: string) {
    if (!ativacaoValida || ocupado) return
    setOperando(true)
    try {
      await ativarCriptografia(senhaDigitada)
      const atualizado = await lerEstado()
      if (atualizado?.estado === 'total') {
        fecharModal()
        setAviso('Banco criptografado. A senha será pedida ao abrir o banco.')
      }
    } finally {
      setOperando(false)
    }
  }

  async function confirmarDesativacao() {
    if (!entendiDesativar || ocupado) return
    setOperando(true)
    try {
      await desativarCriptografia()
      const atualizado = await lerEstado()
      if (atualizado?.estado === 'nenhuma') {
        fecharModal()
        setAviso('Criptografia desativada. O banco voltou a ficar legível.')
      }
    } finally {
      setOperando(false)
    }
  }

  async function confirmarBloqueio() {
    if (ocupado) return
    setOperando(true)
    try {
      const resultado = await bloquearBanco()
      setPendentes(resultado.pendentes)
    } finally {
      setOperando(false)
    }
  }

  /** Backup em `.ods` antes de cifrar — sempre em claro, por isso o aviso. */
  async function exportarBackup() {
    if (!id) return
    setExportando(true)
    setResultadoBackup(null)
    setErroBackup(null)
    try {
      const token = await ensureAccessToken()
      const resultado = await exportarPlanilhaOds(
        { accessToken: token ?? TOKEN_MODO_LOCAL, spreadsheetId: id },
        workspace?.title ?? 'Minhas Ações',
        new Date().toISOString(),
      )
      setResultadoBackup(
        resultado.status === 'cancelado'
          ? 'Exportação cancelada. Recomendado guardar uma cópia antes de criptografar.'
          : `Backup ${resultado.nome} gerado sem criptografia.`,
      )
    } catch (exportError) {
      setErroBackup(describeSheetsError(exportError))
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <LockKeyhole className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={tituloId} className="text-sm font-semibold text-slate-900">
            Segurança do banco
          </h2>
          <p id={descricaoId} className="text-xs text-slate-500">
            Com a criptografia ativa, o arquivo do banco é cifrado (AES-256-GCM) e a senha é pedida
            a cada abertura — ela nunca é armazenada.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              cifrado
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-600',
            )}
          >
            {cifrado ? (
              <Lock className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" aria-hidden />
            )}
            {cifrado ? <span aria-hidden>🔒</span> : null}
            {rotuloEstado}
          </span>
          <Switch
            checked={cifrado}
            onChange={alternar}
            rotuloId={tituloId}
            descricaoId={descricaoId}
            rotulo="Criptografia do banco"
            disabled={motivo !== null || carregando || bloqueado}
            pending={carregando || ocupado}
          />
        </div>
      </div>

      {motivo ? (
        <Alert variant="info" title="Criptografia indisponível">
          {motivo}
        </Alert>
      ) : null}

      {error && modal === null ? <Alert variant="error">{error}</Alert> : null}
      {aviso ? <Alert variant="success">{aviso}</Alert> : null}

      {pendentes !== null ? (
        <Alert variant={pendentes > 0 ? 'info' : 'success'}>
          {pendentes > 0
            ? `Criptografia bloqueada. Há ${pendentes === 1 ? '1 alteração pendente' : `${pendentes} alterações pendentes`} que serão enviadas após o desbloqueio.`
            : 'Criptografia bloqueada.'}
        </Alert>
      ) : null}

      <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>O arquivo .ods é exportado sem criptografia.</span>
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => abrirModal('bloquear')}
          disabled={!cifrado || bloqueado || carregando}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Lock className="h-4 w-4" aria-hidden />
          Bloquear agora
        </button>
      </div>

      <ModalSenha
        open={modal === 'ativar'}
        onClose={fecharModal}
        titulo="Criptografar banco"
        descricao="Isto cifra TODO o conteúdo do banco (operações, proventos, histórico e tokens de API)."
        rotuloConfirmar="Criptografar"
        rotuloSenha="Senha"
        onConfirmar={(senhaDigitada) => void confirmarAtivacao(senhaDigitada)}
        erro={error}
        pending={ocupado}
        confirmarDesabilitado={!ativacaoValida}
        aoMudarSenha={setSenha}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <CampoSenha
            valor={confirmacao}
            aoMudar={setConfirmacao}
            rotulo="Confirmar senha"
            autoComplete="new-password"
            desabilitado={ocupado}
            erro={erroConfirmacao}
          />

          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Sem a senha, os dados são irrecuperáveis.</span>
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

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void exportarBackup()}
              disabled={exportando || ocupado}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportando ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              Exportar backup .ods antes
            </button>
            <p className="text-xs text-amber-800">O arquivo .ods é exportado sem criptografia.</p>
            {resultadoBackup ? <Alert variant="success">{resultadoBackup}</Alert> : null}
            {erroBackup ? <Alert variant="error">{erroBackup}</Alert> : null}
          </div>
        </div>
      </ModalSenha>

      <ModalSenha
        open={modal === 'desativar'}
        onClose={fecharModal}
        pedirSenha={false}
        titulo="Desativar a criptografia"
        descricao="A chave já está nesta sessão, então não é preciso digitá-la de novo. O arquivo do banco voltará a ser gravado em claro."
        rotuloConfirmar="Desativar"
        onConfirmar={() => void confirmarDesativacao()}
        erro={error}
        pending={ocupado}
        confirmarDesabilitado={!entendiDesativar}
        className="max-w-lg"
      >
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={entendiDesativar}
            onChange={(event) => setEntendiDesativar(event.target.checked)}
            disabled={ocupado}
            className="mt-0.5 accent-brand-600"
          />
          <span>Entendi que o arquivo voltará a ser legível</span>
        </label>
      </ModalSenha>

      <ModalSenha
        open={modal === 'bloquear'}
        onClose={fecharModal}
        pedirSenha={false}
        titulo="Bloquear o banco agora?"
        descricao="A chave será esquecida e o cache de abas será apagado deste dispositivo. Para voltar aos dados, a senha será pedida novamente."
        rotuloConfirmar="Bloquear agora"
        rotuloCancelar={pendentes === null ? 'Cancelar' : 'Fechar'}
        onConfirmar={() => void confirmarBloqueio()}
        erro={error}
        pending={ocupado}
        confirmarDesabilitado={pendentes !== null}
        className="max-w-lg"
      >
        {pendentes !== null ? (
          <Alert variant={pendentes > 0 ? 'info' : 'success'}>
            {pendentes > 0
              ? `Criptografia bloqueada. Há ${pendentes === 1 ? '1 alteração pendente' : `${pendentes} alterações pendentes`} que serão enviadas após o desbloqueio.`
              : 'Criptografia bloqueada.'}
          </Alert>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Se houver alterações pendentes, elas ficam na fila e são enviadas após o desbloqueio.
            </span>
          </p>
        )}
      </ModalSenha>
    </div>
  )
}
