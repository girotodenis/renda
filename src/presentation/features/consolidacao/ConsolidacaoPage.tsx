import { Archive, Download, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { ConfirmarConsolidacaoModal } from '@/presentation/features/consolidacao/ConfirmarConsolidacaoModal'
import { TabelaEncerrados } from '@/presentation/features/consolidacao/TabelaEncerrados'
import { TabelaPorAno } from '@/presentation/features/consolidacao/TabelaPorAno'
import { useConsolidacao } from '@/presentation/hooks/useConsolidacao'
import type { AlvoConsolidacao } from '@/domain/consolidacao'
import type { AnoPendente, PendenciaConsolidacao } from '@/domain/consolidacao'
import type { CategoriaAtivo } from '@/domain/entities'

/** Escopo escolhido no modal (inclui a categoria para o aviso de RF/Tesouro). */
interface EscopoSelecionado {
  alvo: AlvoConsolidacao
  categoria: CategoriaAtivo
}

/**
 * Página **Consolidação** (`PLANO_CONSOLIDACAO.md` §5).
 *
 * Enxuga o histórico por ticker/ano sem alterar nenhum número do app: lista os
 * tickers encerrados pendentes e os anos elegíveis dos ativos com posição
 * aberta. Nada acontece sem clique explícito + aceite da irreversibilidade no
 * modal de confirmação.
 */
export function ConsolidacaoPage() {
  const { workspace } = useAuth()
  const {
    painel,
    isLoading,
    isRefreshing,
    isExecutando,
    isExportando,
    isOffline,
    error,
    notice,
    refresh,
    simular,
    consolidar,
    exportarBackup,
  } = useConsolidacao()
  const [escopo, setEscopo] = useState<EscopoSelecionado | null>(null)

  const encerrados = painel?.pendencias.filter((item) => item.estado === 'encerrado') ?? []
  const ativos = painel?.pendencias.filter((item) => item.estado === 'ativo') ?? []
  const simulacao = escopo ? simular(escopo.alvo) : null

  function abrirTicker(pendencia: PendenciaConsolidacao) {
    setEscopo({ alvo: { tipo: 'ticker', ticker: pendencia.ticker }, categoria: pendencia.categoria })
  }

  function abrirAno(pendencia: PendenciaConsolidacao, ano: AnoPendente) {
    setEscopo({
      alvo: { tipo: 'ticker-ano', ticker: pendencia.ticker, ano: ano.ano, modo: ano.modo },
      categoria: pendencia.categoria,
    })
  }

  async function confirmar() {
    if (!escopo) return
    const resultado = await consolidar(escopo.alvo)
    if (resultado) setEscopo(null)
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Archive className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Consolidação</h1>
            <p className="text-sm text-slate-500">
              Enxugue o histórico por ticker/ano sem alterar nenhum número da carteira.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportarBackup()}
            disabled={isExportando || !workspace}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExportando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            Exportar backup
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isRefreshing || !workspace}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              aria-hidden
            />
            Atualizar
          </button>
        </div>
      </header>

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p className="font-semibold">Antes de consolidar</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            A consolidação <strong>só acontece quando você clicar</strong> — nada é automático.
          </li>
          <li>
            Substitui N operações por <strong>1 compra + 1 venda</strong> e N proventos por{' '}
            <strong>1 linha por tipo/ano</strong>.
          </li>
          <li>
            <strong>Não altera</strong> posição, preço médio, total investido, lucro realizado nem
            totais de proventos (verificado antes de gravar).
          </li>
          <li>
            <strong>É irreversível</strong>: as linhas originais são apagadas e não há “Desfazer”.
            Exporte um backup <code>.ods</code> antes (também disponível em{' '}
            <Link to="/configuracoes" className="font-semibold underline">
              Configurações
            </Link>
            ).
          </li>
          <li>
            Reimportar um extrato B3 de um período consolidado <strong>duplica</strong> esse período
            — prefira consolidar apenas períodos que não serão reimportados.
          </li>
        </ul>
      </div>

      {!workspace ? (
        <Alert variant="info" title="Nenhum banco de dados configurado">
          Selecione ou crie um banco de dados em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          antes de consolidar.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {isOffline ? (
        <Alert variant="info" title="Modo offline">
          A lista é exibida do último estado salvo, mas a consolidação exige conexão — os botões
          ficam desabilitados.
        </Alert>
      ) : null}

      {painel && painel.proventosComDataInvalida > 0 ? (
        <Alert variant="info" title="Proventos ignorados">
          {painel.proventosComDataInvalida} provento(s) sem data de pagamento válida ficam fora da
          consolidação. Corrija a data antes de consolidar esses itens.
        </Alert>
      ) : null}

      {isLoading && painel === null ? (
        <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando pendências de consolidação…
        </p>
      ) : null}

      {painel && painel.pendencias.length === 0 ? (
        <Alert variant="success" title="Nada a consolidar">
          Todos os tickers e anos já estão enxutos (ou não há grupos com 2+ linhas). Quando você
          lançar novas operações em um período consolidado, ele volta a aparecer aqui.
        </Alert>
      ) : null}

      {painel && painel.pendencias.length > 0 ? (
        <>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">
                Ativos encerrados (100% vendidos)
              </h2>
              <p className="text-xs text-slate-500">
                Tickers com posição zerada e mais de uma linha de histórico.
              </p>
            </div>
            <TabelaEncerrados
              pendencias={encerrados}
              isOffline={isOffline}
              onConsolidar={abrirTicker}
            />
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">
                Ativos com posição aberta — por ano
              </h2>
              <p className="text-xs text-slate-500">
                Somente anos anteriores a {painel.anoCorrente}. Anos com posição em aberto têm as
                operações preservadas (consolida apenas os proventos).
              </p>
            </div>
            <TabelaPorAno pendencias={ativos} isOffline={isOffline} onConsolidar={abrirAno} />
          </section>
        </>
      ) : null}

      <ConfirmarConsolidacaoModal
        aberto={escopo !== null}
        alvo={escopo?.alvo ?? null}
        categoria={escopo?.categoria ?? null}
        simulacao={simulacao}
        isExecutando={isExecutando}
        isExportando={isExportando}
        isOffline={isOffline}
        onConfirmar={() => void confirmar()}
        onFechar={() => setEscopo(null)}
        onExportarBackup={() => void exportarBackup()}
      />
    </section>
  )
}
