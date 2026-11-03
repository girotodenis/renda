import {
  CheckCircle2,
  Database,
  Loader2,
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
import { describeSheetsError } from '@/infrastructure/sheets/gateway'

const ROTULO_PLANILHA: Record<DiagnosticAmbiente['planilhaCotacoes']['estado'], string> = {
  ativa: 'Ativa',
  'nao-autorizada': 'Não autorizada',
  indisponivel: 'Indisponível',
}

/**
 * Tela de teste/diagnóstico da camada de dados (Etapa 2).
 *
 * Escreve uma linha em cada aba, atualiza o cache com um único `batchGet` e
 * relê do cache **sem novas chamadas** à API (comprovado pelo contador de
 * requisições exibido na tela). O bloco "Estado do ambiente" resume a cifra do
 * banco e a planilha de cotações, lido ao montar — sem rodar as escritas.
 */
export function DiagnosticoPage() {
  const { workspace, status, criptografiaDoBanco, ensureAccessToken } = useAuth()
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [ambiente, setAmbiente] = useState<DiagnosticAmbiente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cacheNotice, setCacheNotice] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

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
      const result = await runDataLayerDiagnostics({
        accessToken: token,
        spreadsheetId: workspace.spreadsheetId,
      })
      setReport(result)
      setAmbiente({ criptografia: result.criptografia, planilhaCotacoes: result.planilhaCotacoes })
    } catch (diagnosticError) {
      setError(describeSheetsError(diagnosticError))
    } finally {
      setIsRunning(false)
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
            <h1 className="text-xl font-semibold text-slate-900">Diagnóstico da camada de dados</h1>
            <p className="text-sm text-slate-500">
              Escreve uma linha em cada aba, atualiza o cache e relê sem novas chamadas à API.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={isRunning || !workspace}
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
              label="Criptografia"
              value={rotuloCriptografia(ambiente)}
              hint={
                ambiente && !ambiente.criptografia.disponivel
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

      {report ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Requisições à API" value={String(report.totalRequests)} />
            <StatCard label="Escritas (5 abas)" value={String(report.writeRequests)} />
            <StatCard label="Refresh (batchGet)" value={String(report.refreshRequests)} />
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
                ? 'Releitura do cache concluída sem novas chamadas à API.'
                : 'A releitura disparou chamadas à API — verifique o cache.'}
            </span>
          </Alert>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <Database className="h-4 w-4 text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-700">Abas testadas</h2>
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
                  <th scope="col" className="px-4 py-2 font-semibold">
                    ID gerado
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Ticker
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
                    <td className="px-4 py-2 font-mono text-xs text-slate-500" data-label="ID gerado">
                      {sheet.appendId ?? '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-600" data-label="Ticker">
                      {report.ticker}
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
  if (ambiente.criptografia.estado !== 'total') return 'Sem criptografia'
  return ambiente.criptografia.bloqueado ? 'Bloqueado' : 'Arquivo criptografado'
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}
