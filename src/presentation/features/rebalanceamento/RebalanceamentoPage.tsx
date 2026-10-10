import { Loader2, RefreshCw, Scale } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { WorkspaceSetup } from '@/features/auth/WorkspaceSetup'
import { CalculadoraAporte } from '@/features/rebalanceamento/CalculadoraAporte'
import { MetasForm } from '@/features/rebalanceamento/MetasForm'
import { TabelaDesvios } from '@/features/rebalanceamento/TabelaDesvios'
import { useRebalanceamento } from '@/hooks/useRebalanceamento'
import {
  calcularDesvios,
  completarConfigComCarteira,
  montarMetaInputs,
  normalizarMetas,
  precoTetoDeConfig,
} from '@/lib/rebalanceamento'
import type { ConfiguracaoMetas } from '@/lib/rebalanceamento'

const CONFIG_VAZIA: ConfiguracaoMetas = { metasClasse: {}, itens: [] }

/**
 * Tela de rebalanceamento (RF12–RF17, Seções 5.2–5.7).
 *
 * Reúne a configuração de metas/notas, a calculadora de aporte (modo apenas
 * aportes e rebalanceamento completo) e os alertas de desvio. Toda a lógica de
 * cálculo fica no módulo puro `lib/rebalanceamento`.
 */
export function RebalanceamentoPage() {
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

  return <RebalanceamentoContent />
}

function RebalanceamentoContent() {
  const { workspace } = useAuth()
  const { data, isLoading, isRefreshing, isSaving, error, notice, refresh, salvar } =
    useRebalanceamento()

  const [config, setConfig] = useState<ConfiguracaoMetas | null>(null)
  const [seedKey, setSeedKey] = useState<string | null>(null)

  // Semente do estado editável: recriada sempre que os dados são recarregados
  // (ajuste de estado durante o render, padrão React para derivar de props).
  if (data && data.carregadoEm !== seedKey) {
    setSeedKey(data.carregadoEm)
    setConfig(completarConfigComCarteira(data.config, data.carteira))
  }

  const carteira = useMemo(() => data?.carteira ?? [], [data])
  const configAtual = config ?? CONFIG_VAZIA

  const metasEfetivas = useMemo(
    () => normalizarMetas(montarMetaInputs(carteira, configAtual)),
    [carteira, configAtual],
  )
  const precoTeto = useMemo(() => precoTetoDeConfig(configAtual), [configAtual])
  const desvios = useMemo(
    () => calcularDesvios(carteira, metasEfetivas, { precoTeto }),
    [carteira, metasEfetivas, precoTeto],
  )
  const tickersNaCarteira = useMemo(
    () => new Set(carteira.map((ativo) => ativo.ticker.trim())),
    [carteira],
  )

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Scale className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Rebalanceamento</h1>
            <p className="text-sm text-slate-500">
              Metas, notas e calculadora de aporte · {workspace?.title ?? 'planilha conectada'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
          Atualizar
        </button>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {isLoading && !data ? (
        <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando dados da carteira…
        </p>
      ) : !data ? null : (
        <>
          {carteira.length === 0 ? (
            <Alert variant="info" title="Carteira vazia">
              Lance suas operações em{' '}
              <Link to="/operacoes" className="font-semibold underline">
                Operações
              </Link>{' '}
              para configurar metas e calcular aportes.
            </Alert>
          ) : null}

          <MetasForm
            key={seedKey ?? 'seed'}
            config={configAtual}
            onChange={setConfig}
            metasEfetivas={metasEfetivas}
            tickersNaCarteira={tickersNaCarteira}
            isSaving={isSaving}
            onSave={() => {
              if (config) void salvar(config)
            }}
          />

          <CalculadoraAporte carteira={carteira} metas={metasEfetivas} precoTeto={precoTeto} />

          <TabelaDesvios desvios={desvios} />
        </>
      )}
    </section>
  )
}
