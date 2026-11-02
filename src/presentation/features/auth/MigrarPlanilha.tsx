import { FileDown } from 'lucide-react'
import { useState } from 'react'
import {
  MSG_MIGRACAO_SEM_ESCOPO,
  detectarBancoLegado,
} from '@/application/migrarPlanilha'
import type { ResultadoMigracao } from '@/application/migrarPlanilha'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import { criarSessao } from '@/infrastructure/cripto/envelope'
import { criptografiaDisponivel } from '@/infrastructure/sheets/gatewayRouter'
import { migracaoStorage } from '@/infrastructure/storage'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { CampoSenha } from '@/presentation/components/CampoSenha'
import { ModalSenha } from '@/presentation/components/ModalSenha'

const MSG_SENHA_VAZIA =
  'Informe uma senha (não há mínimo de tamanho, mas não pode ficar em branco).'

/**
 * Oferta de migração do banco legado (§6.6).
 *
 * Aparece uma única vez por banco legado (dispensa em `localStorage`) para quem
 * entra no build `json` com um workspace que ainda aponta para a planilha do
 * Google Sheets. O caso de uso nunca escreve na planilha antiga — o texto abaixo
 * deixa isso explícito para o usuário.
 */
export function MigrarPlanilha() {
  const { status, workspace, isModoLocal, isBusy, migrarPlanilhaAntiga, dispensarMigracao } =
    useAuth()
  const [fechada, setFechada] = useState(false)
  const [criptografar, setCriptografar] = useState(false)
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [entendi, setEntendi] = useState(false)
  const [erroSenha, setErroSenha] = useState<string | null>(null)
  const [derivando, setDerivando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoMigracao | null>(null)
  const [mensagemFinal, setMensagemFinal] = useState<string | null>(null)

  const legado = detectarBancoLegado(workspace)
  const dispensada =
    workspace !== null && migracaoStorage.dispensada() === workspace.spreadsheetId
  const sessaoValida = status === 'authenticated' || status === 'local'
  const oferecer = legado && sessaoValida && !dispensada && !fechada && !isModoLocal

  const podeCriptografar = criptografiaDisponivel()
  const senhaPreenchida = senha.trim().length > 0
  const senhasConferem = confirmacao === senha
  const criptoValida = !criptografar || (senhaPreenchida && senhasConferem && entendi)
  const ocupado = isBusy || derivando
  const erroVisivel =
    erroSenha ?? (resultado?.status === 'erro' ? resultado.mensagem : null)
  const urlAntiga = workspace?.spreadsheetUrl ?? null

  function alternarCriptografia(marcado: boolean) {
    setCriptografar(marcado)
    setErroSenha(null)
    if (!marcado) {
      setSenha('')
      setConfirmacao('')
      setEntendi(false)
    }
  }

  function agoraNao() {
    dispensarMigracao()
    setFechada(true)
    setResultado(null)
  }

  function mensagemDeSucesso(migracao: Exclude<ResultadoMigracao, { status: 'erro' }>): string {
    if (migracao.status === 'ja-existia') {
      return 'O banco novo já existia e agora está ativo. A planilha antiga continua intacta.'
    }
    const cifrado = migracao.workspace.criptografia === 'total' ? ' e criptografado' : ''
    return `Banco migrado para o novo formato${cifrado} (${migracao.abas} abas). A planilha antiga continua intacta.`
  }

  async function migrar() {
    setErroSenha(null)
    setResultado(null)
    let sessao: SessaoCripto | null = null

    if (criptografar) {
      if (!senhaPreenchida) {
        setErroSenha(MSG_SENHA_VAZIA)
        return
      }
      if (!senhasConferem) {
        setErroSenha('As senhas não conferem.')
        return
      }
      if (!entendi) return

      setDerivando(true)
      try {
        sessao = await criarSessao(senha)
      } catch (erroDerivacao) {
        setErroSenha(
          erroDerivacao instanceof Error && erroDerivacao.message.length > 0
            ? erroDerivacao.message
            : 'Não foi possível preparar a criptografia.',
        )
        return
      } finally {
        setDerivando(false)
      }
    }

    const migracao = await migrarPlanilhaAntiga(sessao ? { chave: sessao } : undefined)
    setResultado(migracao)
    if (migracao.status === 'erro') return

    setMensagemFinal(mensagemDeSucesso(migracao))
    setCriptografar(false)
    setSenha('')
    setConfirmacao('')
    setEntendi(false)
    setFechada(true)
  }

  if (!oferecer) {
    if (!mensagemFinal) return null
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pt-4">
        <Alert variant="success" title="Migração concluída">
          <div className="space-y-2">
            <p>{mensagemFinal}</p>
            <button
              type="button"
              onClick={() => setMensagemFinal(null)}
              className="text-sm font-semibold underline underline-offset-2"
            >
              Fechar
            </button>
          </div>
        </Alert>
      </div>
    )
  }

  return (
    <ModalSenha
      open
      onClose={agoraNao}
      titulo="Migrar minha planilha para o novo formato"
      descricao="Sua carteira será copiada para um banco novo no seu Google Drive. A planilha antiga não é apagada nem alterada."
      rotuloConfirmar="Migrar"
      rotuloCancelar="Agora não"
      onConfirmar={migrar}
      erro={erroVisivel}
      pending={ocupado}
      pedirSenha={false}
      confirmarDesabilitado={!criptoValida}
    >
      <div className="space-y-4">
        {resultado?.status === 'erro' && resultado.mensagem === MSG_MIGRACAO_SEM_ESCOPO ? (
          <Alert variant="info" title="Migrar manualmente pelo .ods">
            <div className="space-y-2">
              <p>
                Sem permissão para ler a planilha antiga pelo app, exporte-a em{' '}
                <strong>.ods</strong> direto do Google Planilhas: abra o link e use{' '}
                <strong>Arquivo → Fazer download → OpenDocument (.ods)</strong>. Se este app ainda
                estiver no build antigo (<strong>Configurações → Exportar para .ods</strong>), o
                arquivo também serve. Depois crie o banco novo e importe o .ods em{' '}
                <strong>Configurações → Importar .ods</strong>.
              </p>
              {urlAntiga ? (
                <a
                  href={urlAntiga}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 font-semibold underline underline-offset-2"
                >
                  <FileDown className="h-4 w-4" aria-hidden />
                  Abrir a planilha antiga
                </a>
              ) : null}
            </div>
          </Alert>
        ) : null}

        {podeCriptografar ? (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={criptografar}
                onChange={(event) => alternarCriptografia(event.target.checked)}
                disabled={ocupado}
                className="mt-0.5 accent-brand-600"
              />
              Criar o novo banco criptografado
            </label>

            {criptografar ? (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <CampoSenha
                  valor={senha}
                  aoMudar={(valor) => {
                    setSenha(valor)
                    setErroSenha(null)
                  }}
                  rotulo="Senha do novo banco"
                  autoComplete="new-password"
                  desabilitado={ocupado}
                  aoEnviar={() => void migrar()}
                />
                <CampoSenha
                  valor={confirmacao}
                  aoMudar={(valor) => {
                    setConfirmacao(valor)
                    setErroSenha(null)
                  }}
                  rotulo="Confirmar senha"
                  autoComplete="new-password"
                  erro={
                    confirmacao.length > 0 && !senhasConferem ? 'As senhas não conferem.' : null
                  }
                  desabilitado={ocupado}
                  aoEnviar={() => void migrar()}
                />
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={entendi}
                    onChange={(event) => setEntendi(event.target.checked)}
                    disabled={ocupado}
                    className="mt-0.5 accent-brand-600"
                  />
                  Entendi que não há recuperação
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </ModalSenha>
  )
}
