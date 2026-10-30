import { Check, CheckCircle2, Database, Download, Eye, EyeOff, HardDrive, KeyRound, Loader2, Palette, Save, Settings, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'
import { useLayout } from '@/presentation/app/providers/layoutContext'
import { LAYOUT_TEMA_LABELS, LAYOUT_TEMAS, LayoutTema } from '@/domain/layout'
import { cn } from '@/presentation/cn'
import { Alert } from '@/presentation/components/Alert'
import { FormField, inputClassName } from '@/presentation/components/FormField'
import { Modal } from '@/presentation/components/Modal'
import { carregarConfiguracoes, salvarConfiguracoes } from '@/application/configuracoes'
import { exportarPlanilhaOds } from '@/application/exportar'
import { analisarOds, aplicarImportacao } from '@/application/importar'
import type { AnaliseImportacao } from '@/application/importar'
import { limparCachesCotacao, listarIntegracoesCotacao } from '@/application/integracoesCotacao'
import type { IntegracaoCotacaoInfo } from '@/application/integracoesCotacao'
import { lerAbasOds } from '@/infrastructure/ods/odsReader'
import { OdsFormatError } from '@/infrastructure/ods/zipReader'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'

/** Integrações de cotação registradas (fixas durante a execução do app). */
const INTEGRACOES = listarIntegracoesCotacao().filter((integracao) => integracao.exigeToken)

/** Apenas os tokens das integrações registradas (demais chaves são preservadas na aba). */
function tokensDasIntegracoes(tokens: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(INTEGRACOES.map(({ id }) => [id, tokens[id] ?? '']))
}

/**
 * Página de configurações das integrações (aba `Configuracoes` da planilha).
 *
 * As credenciais/ajustes ficam **no próprio arquivo do usuário** (Google Sheets)
 * em vez de variáveis de ambiente — cada usuário configura as suas integrações
 * sem recompilar o app. Ao salvar, os caches de cotação são limpos para que os
 * novos valores passem a valer imediatamente.
 */
export function ConfiguracoesPage() {
  const { workspace, ensureAccessToken, isModoLocal, usarModoLocal, logout } = useAuth()
  const { tema, setTema } = useLayout()
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [analise, setAnalise] = useState<AnaliseImportacao | null>(null)
  const inputImportacaoRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!workspace) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const accessToken = await ensureAccessToken()
      if (!accessToken) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      const config = await carregarConfiguracoes({
        accessToken,
        spreadsheetId: workspace.spreadsheetId,
      })
      setTokens({ ...config.tokens })
    } catch (loadError) {
      setError(describeSheetsError(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [workspace, ensureAccessToken])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar() {
    setError(null)
    setNotice(null)
    if (!workspace) {
      setError('Configure uma planilha antes de salvar as configurações.')
      return
    }
    setIsSaving(true)
    try {
      const accessToken = await ensureAccessToken()
      if (!accessToken) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      await salvarConfiguracoes(
        { accessToken, spreadsheetId: workspace.spreadsheetId },
        { tokens: tokensDasIntegracoes(tokens) },
      )
      // Invalida o cache para que o novo token passe a valer já na próxima busca.
      limparCachesCotacao()
      setNotice('Configurações salvas na planilha.')
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  /** Exporta todas as abas da origem ativa para um arquivo `.ods`. */
  async function exportar() {
    setError(null)
    setNotice(null)
    if (!workspace) return

    setIsExporting(true)
    try {
      const accessToken = await ensureAccessToken()
      if (!accessToken) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      const resultado = await exportarPlanilhaOds(
        { accessToken, spreadsheetId: workspace.spreadsheetId },
        workspace.title,
        new Date().toISOString(),
      )
      if (resultado.status === 'cancelado') {
        setNotice('Exportação cancelada.')
      } else {
        setNotice(
          `Arquivo ${resultado.nome} ${resultado.status === 'salvo' ? 'salvo' : 'baixado'} com todas as abas.`,
        )
      }
    } catch (exportError) {
      setError(describeSheetsError(exportError))
    } finally {
      setIsExporting(false)
    }
  }

  /**
   * Alterna a origem de dados: em modo local volta para o Google (o logout limpa
   * a sessão e o modo); em modo Google ativa o banco do navegador.
   */
  async function alternarArmazenamento() {
    setError(null)
    setNotice(null)
    if (isModoLocal) {
      await logout()
      return
    }
    await usarModoLocal()
  }

  /** Lê o arquivo escolhido e mostra o que será substituído (sem gravar nada). */
  async function selecionarArquivo(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0]
    // Limpa o input para permitir escolher o mesmo arquivo novamente depois.
    event.target.value = ''
    if (!arquivo) return

    setError(null)
    setNotice(null)
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      const resultado = analisarOds(await lerAbasOds(bytes))
      if (resultado.abas.length === 0) {
        setError(
          'O arquivo não tem nenhuma aba reconhecida do app (Operações, Proventos, Metas, Histórico, Valuation ou Configurações).',
        )
        return
      }
      setAnalise(resultado)
    } catch (importError) {
      setError(
        importError instanceof OdsFormatError
          ? importError.message
          : describeSheetsError(importError),
      )
    }
  }

  /** Efetiva a importação confirmada, substituindo as abas do arquivo. */
  async function confirmarImportacao() {
    const atual = analise
    if (!atual || !workspace) return

    setIsImporting(true)
    try {
      const accessToken = await ensureAccessToken()
      if (!accessToken) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      const resultado = await aplicarImportacao(
        { accessToken, spreadsheetId: workspace.spreadsheetId },
        atual,
      )
      setAnalise(null)
      setNotice(
        `Importado: ${resultado.abas
          .map((aba) => `${aba.nome} (${aba.linhas})`)
          .join(', ')} · Consolidado recalculado (${resultado.linhasConsolidadas}).`,
      )
    } catch (importError) {
      setError(describeSheetsError(importError))
    } finally {
      setIsImporting(false)
    }
  }

  if (!workspace) {
    return (
      <section className="space-y-5">
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Settings className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold text-slate-900">Configurações</h1>
        </header>
        <Alert variant="info" title="Nenhuma planilha configurada">
          Selecione ou crie uma planilha em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          para editar as configurações.
        </Alert>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Settings className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Configurações</h1>
          <p className="text-sm text-slate-500">
            Integrações do app ficam salvas na própria planilha ({workspace.title}).
          </p>
        </div>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? (
        <Alert variant="success">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {notice}
          </span>
        </Alert>
      ) : null}

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            {isModoLocal ? (
              <HardDrive className="h-4 w-4" aria-hidden />
            ) : (
              <Database className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Armazenamento e exportação</h2>
            <p className="text-xs text-slate-500">
              {isModoLocal ? (
                <>
                  <strong>Modo local</strong>: a carteira está salva apenas neste navegador
                  (IndexedDB) — sem login e sem enviar dados a servidores. Exporte para{' '}
                  <code className="rounded bg-slate-100 px-1">.ods</code> para abrir no LibreOffice,
                  Excel ou Google Planilhas.
                </>
              ) : (
                <>
                  <strong>Modo Google</strong>: a carteira está na planilha{' '}
                  <strong className="font-semibold text-slate-700">{workspace.title}</strong>. Você
                  também pode exportar uma cópia em{' '}
                  <code className="rounded bg-slate-100 px-1">.ods</code>.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void exportar()}
            disabled={isExporting}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            Exportar para .ods
          </button>

          <button
            type="button"
            onClick={() => inputImportacaoRef.current?.click()}
            disabled={isImporting}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            Importar .ods
          </button>

          <input
            ref={inputImportacaoRef}
            type="file"
            accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
            className="hidden"
            onChange={(event) => void selecionarArquivo(event)}
          />

          <button
            type="button"
            onClick={() => void alternarArmazenamento()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            {isModoLocal ? (
              <Database className="h-4 w-4" aria-hidden />
            ) : (
              <HardDrive className="h-4 w-4" aria-hidden />
            )}
            {isModoLocal ? 'Voltar para o Google' : 'Usar sem Google (neste navegador)'}
          </button>
        </div>

        {!isModoLocal ? (
          <Alert variant="info" title="Ao usar sem Google">
            A carteira passa a ser salva no banco de dados deste navegador (sem login). A planilha
            do Google continua intacta, e o conteúdo local pode ser exportado para{' '}
            <code>.ods</code> a qualquer momento.
          </Alert>
        ) : null}
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Palette className="h-4 w-4" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Layout do app</h2>
            <p className="text-xs text-slate-500">
              Escolha a aparência do aplicativo. A preferência fica salva neste navegador.
            </p>
          </div>
        </div>

        <div role="radiogroup" aria-label="Layout do app" className="grid gap-3 sm:grid-cols-2">
          {LAYOUT_TEMAS.map((opcao) => {
            const ativa = tema === opcao
            return (
              <button
                key={opcao}
                type="button"
                role="radio"
                aria-checked={ativa}
                onClick={() => setTema(opcao)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  ativa
                    ? 'border-brand-500 ring-2 ring-brand-500/30'
                    : 'border-slate-200 hover:border-brand-300',
                )}
              >
                <span className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {LAYOUT_TEMA_LABELS[opcao]}
                  </span>
                  {ativa ? <Check className="h-4 w-4 text-brand-600" aria-hidden /> : null}
                </span>
                <PreviewLayout tema={opcao} />
              </button>
            )
          })}
        </div>
      </div>

      {INTEGRACOES.map((integracao) => (
        <TokenIntegracaoCard
          key={integracao.id}
          integracao={integracao}
          valor={tokens[integracao.id] ?? ''}
          onChange={(valor) => setTokens((atuais) => ({ ...atuais, [integracao.id]: valor }))}
          disabled={isLoading || isSaving}
          isModoLocal={isModoLocal}
        />
      ))}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={isLoading || isSaving}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Salvar configurações
        </button>
      </div>

      <Modal
        open={analise !== null}
        onClose={() => setAnalise(null)}
        titulo="Importar arquivo .ods"
        className="max-w-lg"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>As abas abaixo serão substituídas pelo conteúdo do arquivo:</p>

          <ul className="space-y-1">
            {analise?.abas.map((aba) => (
              <li
                key={aba.nome}
                className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"
              >
                <span className="font-medium text-slate-700">{aba.nome}</span>
                <span className="text-xs text-slate-500">
                  {aba.linhas} {aba.linhas === 1 ? 'linha' : 'linhas'}
                </span>
              </li>
            ))}
          </ul>

          {analise?.temConsolidado ? (
            <p className="text-xs text-slate-500">
              A aba <strong>Consolidado</strong> do arquivo é ignorada: ela é recalculada a partir
              das operações importadas.
            </p>
          ) : null}

          {analise && analise.desconhecidas.length > 0 ? (
            <p className="text-xs text-slate-500">
              Abas não reconhecidas (ignoradas): {analise.desconhecidas.join(', ')}.
            </p>
          ) : null}

          <Alert variant="error" title="Isto substitui os dados atuais">
            O conteúdo atual dessas abas é apagado antes da importação
            {isModoLocal ? ' do banco local' : ' da planilha'}. Exporte um backup antes, se precisar.
          </Alert>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => setAnalise(null)}
            disabled={isImporting}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirmarImportacao()}
            disabled={isImporting}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            Substituir dados
          </button>
        </div>
      </Modal>
    </section>
  )
}

/** Miniatura visual do tema, exibida no seletor de layout. */
function PreviewLayout({ tema }: { tema: LayoutTema }) {
  if (tema === LayoutTema.Propaganda) {
    return (
      <div className="overflow-hidden rounded-md border border-white/10 bg-[#0b1220] p-2">
        <div className="h-2 w-2/3 rounded-full bg-gradient-to-r from-[#22c55e] to-[#16a34a]" />
        <div className="mt-1.5 h-5 rounded-sm bg-[#16223c]" />
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="h-2 w-2/3 rounded-full bg-gradient-to-r from-[#60a5fa] to-[#2563eb]" />
      <div className="mt-1.5 h-5 rounded-sm bg-white shadow-sm" />
    </div>
  )
}

interface TokenIntegracaoCardProps {
  integracao: IntegracaoCotacaoInfo
  valor: string
  onChange: (valor: string) => void
  disabled: boolean
  isModoLocal: boolean
}

/** Campo de token de uma integração de cotações (um card por API registrada). */
function TokenIntegracaoCard({
  integracao,
  valor,
  onChange,
  disabled,
  isModoLocal,
}: TokenIntegracaoCardProps) {
  const [mostrarToken, setMostrarToken] = useState(false)
  const inputId = `${integracao.id}-token`
  const dominio = integracao.site.replace(/^https?:\/\//, '').replace(/\/$/, '')

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <KeyRound className="h-4 w-4" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">Token da {integracao.nome}</h2>
          <p className="text-xs text-slate-500">
            Usado como <strong>fallback de cotação da B3</strong> (Ação/FII/BDR/ETF) quando o
            <code className="mx-1 rounded bg-slate-100 px-1">GOOGLEFINANCE</code>da planilha não
            retorna preço.
          </p>
          <p className="text-xs text-slate-500">
            <strong>Como obter:</strong> acesse{' '}
            <a
              href={integracao.site}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline"
            >
              {dominio}
            </a>{' '}
            e {integracao.comoObter ?? 'copie o seu token no painel.'} Deixe em branco para
            desativar o fallback.
          </p>
        </div>
      </div>

      <FormField
        htmlFor={inputId}
        label={`Token da ${integracao.nome}`}
        hint={
          isModoLocal
            ? 'Fica salvo na aba Configurações do banco local deste navegador.'
            : 'Fica salvo na sua planilha do Google Drive — não é enviado a nenhum servidor do app.'
        }
      >
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type={mostrarToken ? 'text' : 'password'}
            value={valor}
            onChange={(evento) => onChange(evento.target.value)}
            placeholder="Cole aqui o seu token"
            spellCheck={false}
            autoComplete="off"
            className={inputClassName}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => setMostrarToken((atual) => !atual)}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
            aria-label={mostrarToken ? 'Ocultar token' : 'Mostrar token'}
          >
            {mostrarToken ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
            {mostrarToken ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </FormField>
    </div>
  )
}
