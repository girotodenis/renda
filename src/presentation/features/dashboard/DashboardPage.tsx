import { ExternalLink, Files, LayoutDashboard, Loader2, RefreshCw, Save } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TrocarPlanilhaModal } from '@/features/auth/TrocarPlanilhaModal'
import { WorkspaceSetup } from '@/features/auth/WorkspaceSetup'
import { DetalheAtivoModal } from '@/features/dashboard/DetalheAtivoModal'
import { NovaOperacaoModal } from '@/features/dashboard/NovaOperacaoModal'
import { ResumoPatrimonial } from '@/features/dashboard/ResumoPatrimonial'
import { TabelaAtivos } from '@/features/dashboard/TabelaAtivos'
import { ValorManualModal } from '@/features/dashboard/ValorManualModal'
import type { AlvoValorManual } from '@/features/dashboard/ValorManualModal'
import { useDashboard } from '@/hooks/useDashboard'
import { alocacaoPorAtivo, alocacaoPorCategoria, serieEvolucao } from '@/lib/dashboard'
import { precosManuaisDeOperacoes } from '@/lib/cotacoes'
import { calcularDetalheAtivo } from '@/lib/detalheAtivo'
import { tickersComOportunidade } from '@/domain/valuation'
import type { CategoriaAtivo } from '@/types/domain'

/**
 * Gráficos carregados sob demanda (lazy) para não inflar o bundle inicial com
 * o Recharts — o dashboard aparece rápido e os gráficos chegam em seguida
 * (RNF06).
 */
const AlocacaoChart = lazy(() =>
  import('@/features/dashboard/AlocacaoChart').then((modulo) => ({
    default: modulo.AlocacaoChart,
  })),
)
const EvolucaoChart = lazy(() =>
  import('@/features/dashboard/EvolucaoChart').then((modulo) => ({
    default: modulo.EvolucaoChart,
  })),
)

/**
 * Dashboard (RF07–RF11, RF18) — tela inicial de desempenho da carteira após o
 * login. Exibe o resumo patrimonial, a alocação, a evolução patrimonial e a
 * tabela de ativos. O extrato de proventos vive na tela de Proventos.
 */
export function DashboardPage() {
  const { workspace, error } = useAuth()

  if (!workspace) {
    return (
      <section className="mx-auto max-w-xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Configurar planilha</h1>
          <p className="text-sm text-slate-500">
            Escolha uma planilha existente no Drive ou crie a planilha padrão com as 5 abas.
          </p>
        </header>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <WorkspaceSetup />
      </section>
    )
  }

  return <DashboardContent />
}

function DashboardContent() {
  const { workspace } = useAuth()
  const {
    data,
    isLoading,
    isRefreshing,
    isSavingSnapshot,
    isOffline,
    error,
    notice,
    refresh,
    registrarSnapshotManual,
  } = useDashboard()

  const consolidado = useMemo(() => data?.consolidado ?? [], [data])
  const porCategoria = useMemo(() => alocacaoPorCategoria(consolidado), [consolidado])
  const porAtivo = useMemo(() => alocacaoPorAtivo(consolidado), [consolidado])
  const serie = useMemo(() => serieEvolucao(data?.historico ?? []), [data])
  const [ativoSelecionado, setAtivoSelecionado] = useState<string | null>(null)
  const [categoriaNovaOperacao, setCategoriaNovaOperacao] = useState<CategoriaAtivo | null>(null)
  const [valorManualAlvo, setValorManualAlvo] = useState<AlvoValorManual | null>(null)
  const [trocarPlanilhaAberto, setTrocarPlanilhaAberto] = useState(false)
  const detalheAtivo = useMemo(
    () =>
      ativoSelecionado && data
        ? calcularDetalheAtivo(ativoSelecionado, data.operacoes, data.proventos, data.consolidado)
        : null,
    [ativoSelecionado, data],
  )
  const oportunidades = useMemo(
    () => tickersComOportunidade(data?.valuation ?? [], consolidado),
    [data, consolidado],
  )
  const valuationAtivo = useMemo(() => {
    if (!ativoSelecionado || !data) return null
    const alvo = ativoSelecionado.trim().toUpperCase()
    return data.valuation.find((item) => item.ticker.trim().toUpperCase() === alvo) ?? null
  }, [ativoSelecionado, data])
  const valorManualAtual = useMemo(() => {
    if (!valorManualAlvo) return null
    return precosManuaisDeOperacoes(data?.operacoes ?? []).get(valorManualAlvo.ticker) ?? null
  }, [valorManualAlvo, data])
  const cotacaoManualAlvo = useMemo(
    () => (valorManualAlvo ? (data?.cotacoes.get(valorManualAlvo.ticker) ?? null) : null),
    [valorManualAlvo, data],
  )
  const cotacoesIndisponiveis = useMemo(() => {
    const lista: string[] = []
    for (const cotacao of data?.cotacoes.values() ?? []) {
      if (cotacao.status === 'indisponivel') lista.push(cotacao.ticker)
    }
    return lista
  }, [data])

  const sheetUrl = workspace
    ? (workspace.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${workspace.spreadsheetId}/edit`)
    : '#'

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <LayoutDashboard className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">
              Desempenho da carteira · {workspace?.title ?? 'planilha conectada'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={sheetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Abrir no Google Sheets
          </a>
          <button
            type="button"
            onClick={() => setTrocarPlanilhaAberto(true)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            <Files className="h-4 w-4" aria-hidden />
            Trocar planilha
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => void registrarSnapshotManual()}
            disabled={isSavingSnapshot || !data}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSavingSnapshot ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Registrar snapshot
          </button>
        </div>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {isOffline ? (
        <Alert variant="info" title="Modo offline">
          Sem conexão com a internet. Exibindo o último estado da carteira salvo em cache.
        </Alert>
      ) : null}
      {!isOffline && cotacoesIndisponiveis.length > 0 ? (
        <Alert variant="info" title="Cotação indisponível">
          Não foi possível obter a cotação de {cotacoesIndisponiveis.join(', ')}. Exibimos o preço
          médio como referência — os demais dados seguem normalmente.
        </Alert>
      ) : null}

      {isLoading && !data ? (
        <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando dados da carteira…
        </p>
      ) : !data ? null : (
        <>
          <ResumoPatrimonial resumo={data.resumo} />

          {consolidado.length === 0 && data.proventos.length === 0 ? (
            <Alert variant="info" title="Carteira vazia">
              Lance suas operações em <strong>Operações</strong> para ver o resumo patrimonial, os
              gráficos e a tabela de ativos.
            </Alert>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <ErrorBoundary title="Alocação indisponível">
              <Suspense fallback={<ChartFallback titulo="Carregando alocação…" />}>
                <AlocacaoChart porCategoria={porCategoria} porAtivo={porAtivo} />
              </Suspense>
            </ErrorBoundary>
            <ErrorBoundary title="Evolução indisponível">
              <Suspense fallback={<ChartFallback titulo="Carregando evolução…" />}>
                <EvolucaoChart serie={serie} />
              </Suspense>
            </ErrorBoundary>
          </div>

          <TabelaAtivos
            consolidado={consolidado}
            cotacoes={data.cotacoes}
            oportunidades={oportunidades}
            onSelecionarAtivo={setAtivoSelecionado}
            onNovaOperacao={setCategoriaNovaOperacao}
            onEditarValorManual={(ticker, categoria) => setValorManualAlvo({ ticker, categoria })}
          />
          <DetalheAtivoModal
            detalhe={detalheAtivo}
            operacoes={data.operacoes}
            proventos={data.proventos}
            valuation={valuationAtivo}
            onChanged={refresh}
            onClose={() => setAtivoSelecionado(null)}
          />
          <NovaOperacaoModal
            categoria={categoriaNovaOperacao}
            onClose={() => setCategoriaNovaOperacao(null)}
            onSaved={refresh}
          />
          <ValorManualModal
            alvo={valorManualAlvo}
            valorManualAtual={valorManualAtual}
            cotacaoAtual={cotacaoManualAlvo}
            onClose={() => setValorManualAlvo(null)}
            onSaved={refresh}
          />
        </>
      )}

      <TrocarPlanilhaModal
        open={trocarPlanilhaAberto}
        onClose={() => setTrocarPlanilhaAberto(false)}
      />
    </section>
  )
}

function ChartFallback({ titulo }: { titulo: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {titulo}
      </span>
    </div>
  )
}
