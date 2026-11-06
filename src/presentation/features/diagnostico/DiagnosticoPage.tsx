import {
  CheckCircle2,
  Database,
  Gauge,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { ConfirmarBloqueio } from '@/presentation/components/ConfirmarBloqueio'
import { clearAllSheetCache } from '@/infrastructure/cache'
import { lerDiagnosticoAmbiente, runDataLayerDiagnostics } from '@/application/diagnostics'
import type { DiagnosticAmbiente, DiagnosticReport } from '@/application/diagnostics'
import { testarIntegracoesCotacao } from '@/application/integracoesCotacao'
import type { DiagnosticoIntegracoes, TesteIntegracaoInfo } from '@/application/integracoesCotacao'
import type { QuotaProvedor } from '@/domain/provedoresCotacao'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'

const ROTULO_PLANILHA: Record<DiagnosticAmbiente['planilhaCotacoes']['estado'], string> = {
  ativa: 'Ativa',
  'nao-autorizada': 'Não autorizada',
  indisponivel: 'Indisponível',
}

/**
 * Tela de teste/diagnóstico da camada de dados e das integrações.
 *
 * O bloco da camada de dados é **somente leitura**: lê as abas com um único
 * `batchGet` e relê do cache **sem novas chamadas** à API (comprovado pelo
 * contador de requisições exibido na tela). Nenhuma linha de teste é gravada.
 * O bloco de integrações testa cada API de cotação com o token do usuário e
 * mostra a cota restante quando a API devolve os headers `RateLimit-*`.
 */
export function DiagnosticoPage() {
  const { workspace, status, criptografiaDoBanco, ensureAccessToken } = useAuth()
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [ambiente, setAmbiente] = useState<DiagnosticAmbiente | null>(null)
  const [integracoes, setIntegracoes] = useState<DiagnosticoIntegracoes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cacheNotice, setCacheNotice] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isTestingIntegrations, setIsTestingIntegrations] = useState(false)

  const spreadsheetId = workspace?.spreadsheetId ?? null
  // O metadado do workspace responde antes da leitura do arquivo terminar.
  const cifrado = (ambiente?.criptografia.estado ?? criptografiaDoBanco) === 'total'

  useEffect(() => {
    if (!spreadsheetId) {
      setAmbiente(null)
      return
    }

    let cancelado = false
    void (async () => {
      // Sem token não há como ler o magic do arquivo remoto: cai no estado local.
      const token = await ensureAccessToken().catch(() => null)
      const resultado = await lerDiagnosticoAmbiente(
        token ? { accessToken: token, spreadsheetId } : null,
      )
      if (!cancelado) setAmbiente(resultado)
    })()

    return () => {
      cancelado = true
    }
  }, [ensureAccessToken, spreadsheetId])

  async function runDiagnostics() {
    setError(null)
    if (!workspace) {
      setError('Configure um banco de dados antes de executar o diagnóstico.')
      return
    }

    setIsRunning(true)
    try {
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      const contexto = { accessToken: token, spreadsheetId: workspace.spreadsheetId }
      // Sequencial: o teste das integrações lê as configurações e não pode
      // contaminar os contadores de requisição da camada de dados.
      const result = await runDataLayerDiagnostics(contexto)
      setReport(result)
      setAmbiente({ criptografia: result.criptografia, planilhaCotacoes: result.planilhaCotacoes })
      const testes = await testarIntegracoesCotacao(contexto)
      setIntegracoes(testes)
    } catch (diagnosticError) {
      setError(describeSheetsError(diagnosticError))
    } finally {
      setIsRunning(false)
    }
  }

  async function runIntegrationTests() {
    setError(null)
    if (!workspace) {
      setError('Configure um banco de dados antes de testar as integrações.')
      return
    }

    setIsTestingIntegrations(true)
    try {
      const token = await ensureAccessToken()
      if (!token) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      const testes = await testarIntegracoesCotacao({
        accessToken: token,
        spreadsheetId: workspace.spreadsheetId,
      })
      setIntegracoes(testes)
    } catch (testError) {
      setError(describeSheetsError(testError))
    } finally {
      setIsTestingIntegrations(false)
    }
  }

  function clearCache() {
    const removed = clearAllSheetCache()
    setReport(null)
    setError(null)
    setCacheNotice(`Cache local limpo (${removed} ${removed === 1 ? 'entrada' : 'entradas'}).`)
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Stethoscope className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Diagnóstico do banco e integrações</h1>
            <p className="text-sm text-slate-500">
              Verifica as integrações, a cota das APIs e o estado do banco — sem gravar nenhuma
              linha de teste.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={isRunning || isTestingIntegrations || !workspace}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            Executar diagnóstico
          </button>
          <button
            type="button"
            onClick={() => void runIntegrationTests()}
            disabled={isRunning || isTestingIntegrations || !workspace}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isTestingIntegrations ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="h-4 w-4" aria-hidden />
            )}
            Testar integrações
          </button>
          <button
            type="button"
            onClick={clearCache}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Limpar cache local
          </button>
        </div>
      </header>

      {!workspace ? (
        <Alert variant="info" title="Nenhum banco de dados configurado">
          Selecione ou crie um banco de dados em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          antes de rodar o diagnóstico.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {cacheNotice ? <Alert variant="success">{cacheNotice}</Alert> : null}

      {workspace ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-700">Estado do ambiente</h2>
            </div>
            {cifrado && status !== 'bloqueado' ? (
              <ConfirmarBloqueio
                rotulo="Bloquear agora"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              />
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Banco criptografado"
              value={rotuloCriptografia(ambiente)}
              hint={
                ambiente && !ambiente.criptografia.verificado
                  ? 'Não foi possível ler o arquivo do banco agora — estado não verificado.'
                  : ambiente && !ambiente.criptografia.disponivel
                    ? 'Este backend ou navegador não cifra o banco.'
                    : null
              }
            />
            <StatCard
              label="Planilha de cotações"
              value={ambiente ? ROTULO_PLANILHA[ambiente.planilhaCotacoes.estado] : 'Lendo…'}
              hint={ambiente?.planilhaCotacoes.motivo ?? null}
            />
          </div>
        </section>
      ) : null}

      {workspace ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-700">Integrações de cotação</h2>
            </div>
            {integracoes ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  integracoes.todasOk
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {integracoes.todasOk ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                )}
                {integracoes.todasOk ? 'Todas respondendo' : 'Verifique os avisos'}
                <span className="font-normal text-slate-500">
                  · {formatTimestamp(integracoes.finishedAt)}
                </span>
              </span>
            ) : null}
          </div>

          {integracoes ? (
            <table className="tabela-responsiva w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Integração
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Requisições disponíveis
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Detalhe
                  </th>
                </tr>
              </thead>
              <tbody>
                {integracoes.testes.map((teste) => {
                  const status = rotuloTeste(teste)
                  const quota = rotuloQuota(teste.resultado.quota)
                  return (
                    <tr key={teste.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3" data-card-title>
                        <p className="font-medium text-slate-700">{teste.nome}</p>
                        {teste.exigeToken ? (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                            <KeyRound className="h-3 w-3" aria-hidden />
                            {teste.tokenConfigurado ? 'Token configurado' : 'Sem token'}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3" data-label="Status">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${status.classe}`}
                        >
                          {status.texto}
                        </span>
                      </td>
                      <td className="px-4 py-3" data-label="Requisições disponíveis">
                        <p className="inline-flex items-center gap-1.5 tabular-nums text-slate-700">
                          <Gauge className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                          {quota.valor}
                        </p>
                        {quota.detalhe ? (
                          <p className="mt-0.5 text-xs text-slate-500">{quota.detalhe}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600" data-label="Detalhe">
                        {teste.resultado.mensagem}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-4 text-sm text-slate-500">
              Clique em “Testar integrações” para consultar cada API com o token configurado e ver
              a cota restante. Cada integração faz uma única requisição ao ticker de referência
              (consome 1 requisição/crédito do plano).
            </p>
          )}
        </section>
      ) : null}

      {report ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Requisições totais" value={String(report.totalRequests)} />
            <StatCard label="Leituras (batchGet)" value={String(report.readRequests)} />
            <StatCard
              label="Leitura do cache"
              value={report.cacheReadRequests === 0 ? '0 chamadas' : `${report.cacheReadRequests}`}
            />
          </div>

          <Alert variant={report.cacheReadUsedNoRequests ? 'success' : 'error'}>
            <span className="inline-flex items-center gap-2">
              {report.cacheReadUsedNoRequests ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              ) : (
                <XCircle className="h-4 w-4" aria-hidden />
              )}
              {report.cacheReadUsedNoRequests
                ? 'Releitura do cache concluída sem novas chamadas à API. Nenhuma linha de teste foi gravada.'
                : 'A releitura disparou chamadas à API — verifique o cache.'}
            </span>
          </Alert>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <Database className="h-4 w-4 text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-700">Abas lidas</h2>
              <span className="ml-auto text-xs text-slate-500">
                Concluído em {formatTimestamp(report.finishedAt)}
              </span>
            </div>
            <table className="tabela-responsiva w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Aba
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Linhas no cache
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.sheets.map((sheet) => (
                  <tr key={sheet.sheetName} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-700" data-card-title>
                      {sheet.sheetName}
                    </td>
                    <td
                      className="px-4 py-2 text-right tabular-nums text-slate-700"
                      data-label="Linhas no cache"
                    >
                      {sheet.cachedRowCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

/** Rótulos da §3.3: sem cifra, cifrado e desbloqueado, cifrado e bloqueado. */
function rotuloCriptografia(ambiente: DiagnosticAmbiente | null): string {
  if (!ambiente) return 'Lendo…'
  if (!ambiente.criptografia.verificado) return 'Não verificado'
  if (ambiente.criptografia.estado !== 'total') return 'Não'
  return ambiente.criptografia.bloqueado ? 'Sim (bloqueado nesta sessão)' : 'Sim (AES-256-GCM)'
}

/** Status exibido para cada integração testada. */
function rotuloTeste(teste: TesteIntegracaoInfo): { texto: string; classe: string } {
  if (teste.resultado.ok) {
    return { texto: 'Funcionando', classe: 'bg-emerald-50 text-emerald-700' }
  }
  // Fonte opcional (sem token): não estar ativa não é falha.
  if (!teste.exigeToken) {
    return { texto: 'Não ativa', classe: 'bg-slate-100 text-slate-600' }
  }
  if (!teste.tokenConfigurado) {
    return { texto: 'Sem token', classe: 'bg-amber-50 text-amber-700' }
  }
  return { texto: 'Falha', classe: 'bg-red-50 text-red-700' }
}

/**
 * Cota restante informada pela API (`RateLimit-*`).
 *
 * Sem headers de cota — ou em provedores que não os enviam — mostra só “não
 * informado”, sem inventar números.
 */
function rotuloQuota(quota: QuotaProvedor | null): { valor: string; detalhe: string | null } {
  if (!quota) return { valor: 'Não informado', detalhe: null }
  const restante = quota.restante === null ? null : quota.restante.toLocaleString('pt-BR')
  const limite = quota.limite === null ? null : quota.limite.toLocaleString('pt-BR')
  const valor =
    restante !== null && limite !== null
      ? `${restante} de ${limite}`
      : (restante ?? limite ?? 'Não informado')
  const detalhe =
    quota.reinicioEmSegundos === null
      ? null
      : `Reinicia em ${formatarDuracao(quota.reinicioEmSegundos)}`
  return { valor, detalhe }
}

function formatarDuracao(segundos: number): string {
  if (segundos < 60) return `${segundos}s`
  if (segundos < 3600) return `${Math.ceil(segundos / 60)} min`
  if (segundos < 86400) return `${Math.round(segundos / 3600)} h`
  return `${Math.round(segundos / 86400)} dias`
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}
