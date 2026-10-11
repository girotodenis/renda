import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { Modal } from '@/presentation/components/Modal'
import { CATEGORIA_ATIVO_LABELS, categoriaLabel } from '@/domain/categoria'
import { cn } from '@/presentation/cn'
import { formatarDataBR } from '@/domain/dates'
import type { DetalheAtivo } from '@/domain/detalheAtivo'
import { eventosDeOperacoes, isTipoEventoCorporativo } from '@/domain/eventosCorporativos'
import { alterarCategoriaDoTicker } from '@/application/operacoes'
import type { ResultadoTrocaCategoria } from '@/application/operacoes'
import { oportunidadeDeCompra } from '@/domain/valuation'
import { classeValor, formatarCentavos, formatarPercentual } from '@/presentation/features/dashboard/formatters'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import { CategoriaAtivo } from '@/domain/entities'
import type { Operacao, Provento, Valuation } from '@/domain/entities'
import { DetalheAtivoEventos } from './DetalheAtivoEventos'
import { DetalheAtivoOperacoes } from './DetalheAtivoOperacoes'
import { DetalheAtivoProventos } from './DetalheAtivoProventos'
import { DetalheAtivoValuation } from './DetalheAtivoValuation'
import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'

/** Gráficos carregados sob demanda (Recharts fora do bundle inicial — RNF06). */
const DetalheAtivoGraficos = lazy(() =>
  import('@/presentation/features/dashboard/DetalheAtivoGraficos').then((modulo) => ({
    default: modulo.DetalheAtivoGraficos,
  })),
)

/** Abas do modal do ativo: resumo + listas editáveis por tipo de lançamento. */
type AbaId = 'resumo' | 'operacoes' | 'proventos' | 'eventos' | 'valuation'

interface DetalheAtivoModalProps {
  /** Detalhe do ativo selecionado; `null` mantém o modal fechado. */
  detalhe: DetalheAtivo | null
  /** Operações do dashboard (base das abas Operações e Eventos). */
  operacoes: readonly Operacao[]
  /** Proventos do extrato (Resumo + aba Proventos). */
  proventos: readonly Provento[]
  /** Análise de valuation do ticker (`null` quando ainda não cadastrada). */
  valuation: Valuation | null
  /** Recarrega os dados do dashboard após registrar/editar/excluir um lançamento. */
  onChanged: () => Promise<void>
  onClose: () => void
  /** Abre o ticker anterior na ordem da tabela de ativos (navegação circular). */
  onAnterior?: () => void
  /** Abre o próximo ticker na ordem da tabela de ativos (navegação circular). */
  onProximo?: () => void
  /** Posição atual na navegação (1-based) — usada nos rótulos acessíveis. */
  posicaoNavegacao?: number
  /** Total de tickers navegáveis — usado nos rótulos acessíveis. */
  totalNavegacao?: number
}

function formatarCentavosOuTraco(centavos: number | null): string {
  return centavos === null ? '—' : formatarCentavos(centavos)
}

/** Descrição pluralizada de uma contagem (ex.: `3 operações`). */
function descreverContagem(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`
}

/** Mensagem de sucesso da troca de categoria, com o total por aba. */
function mensagemTrocaCategoria(
  resultado: ResultadoTrocaCategoria,
  categoria: CategoriaAtivo,
): string {
  const partes: string[] = []
  if (resultado.operacoes > 0) {
    partes.push(descreverContagem(resultado.operacoes, 'operação', 'operações'))
  }
  if (resultado.proventos > 0) {
    partes.push(descreverContagem(resultado.proventos, 'provento', 'proventos'))
  }
  if (resultado.metas > 0) {
    partes.push(descreverContagem(resultado.metas, 'meta', 'metas'))
  }
  if (partes.length === 0) return 'Nenhum registro encontrado para atualizar a categoria.'
  return `Categoria atualizada para ${categoriaLabel(categoria)}: ${partes.join(', ')}.`
}

/**
 * Modal de detalhe do ativo (RF10) com abas: **Resumo** (menor/maior compra,
 * preço médio, proventos do período, valor investido, as duas visões de
 * rentabilidade e os gráficos), **Operações**, **Proventos** e **Eventos**.
 *
 * As três últimas abas listam os lançamentos do ticker e permitem cadastrar,
 * editar e excluir sem sair do dashboard; após cada escrita os dados do
 * dashboard são recarregados (`onChanged`).
 */
export function DetalheAtivoModal({
  detalhe,
  operacoes,
  proventos,
  valuation,
  onChanged,
  onClose,
  onAnterior,
  onProximo,
  posicaoNavegacao,
  totalNavegacao,
}: DetalheAtivoModalProps) {
  const { workspace, ensureAccessToken } = useAuth()
  const [aba, setAba] = useState<AbaId>('resumo')
  const [alterandoCategoria, setAlterandoCategoria] = useState(false)
  const [erroCategoria, setErroCategoria] = useState<string | null>(null)
  const [avisoCategoria, setAvisoCategoria] = useState<string | null>(null)
  const ticker = detalhe?.ticker ?? null

  // Reabre sempre na aba Resumo ao trocar de ativo.
  useEffect(() => {
    setAba('resumo')
    setErroCategoria(null)
    setAvisoCategoria(null)
  }, [ticker])

  /**
   * Troca a categoria do ticker: atualiza todas as operações do ativo na aba
   * `Operacoes`, recalcula o consolidado e recarrega o dashboard.
   */
  const alterarCategoria = useCallback(
    async (novaCategoria: CategoriaAtivo) => {
      if (!detalhe || novaCategoria === detalhe.categoria) return

      const confirmado = window.confirm(
        `Trocar a categoria de ${detalhe.ticker} para ${categoriaLabel(novaCategoria)}? ` +
          'Operações, proventos e metas deste ticker serão atualizados.',
      )
      if (!confirmado) return

      setErroCategoria(null)
      setAvisoCategoria(null)

      if (!workspace) {
        setErroCategoria('Configure uma planilha antes de alterar a categoria.')
        return
      }
      const token = await ensureAccessToken()
      if (!token) {
        setErroCategoria('Sessão expirada. Faça login novamente.')
        return
      }

      const context: RepositoryContext = {
        accessToken: token,
        spreadsheetId: workspace.spreadsheetId,
      }

      setAlterandoCategoria(true)
      try {
        const resultado = await alterarCategoriaDoTicker(
          context,
          detalhe.ticker,
          novaCategoria,
        )
        await sincronizarConsolidadoESnapshot(context)
        await onChanged()
        setAvisoCategoria(mensagemTrocaCategoria(resultado, novaCategoria))
      } catch (error) {
        setErroCategoria(describeSheetsError(error))
      } finally {
        setAlterandoCategoria(false)
      }
    },
    [detalhe, workspace, ensureAccessToken, onChanged],
  )

  const contadores = useMemo(() => {
    if (!detalhe) return { operacoes: 0, proventos: 0, eventos: 0 }
    const alvo = detalhe.ticker.trim().toUpperCase()
    const operacoesDoAtivo = operacoes.filter(
      (operacao) => operacao.ticker.trim().toUpperCase() === alvo,
    )
    return {
      operacoes: operacoesDoAtivo.filter((operacao) => !isTipoEventoCorporativo(operacao.tipo))
        .length,
      proventos: proventos.filter((provento) => provento.ticker.trim().toUpperCase() === alvo)
        .length,
      eventos: eventosDeOperacoes(operacoesDoAtivo).length,
    }
  }, [detalhe, operacoes, proventos])

  /** Alerta de oportunidade de compra (cotação ≤ teto − margem) no cabeçalho. */
  const oportunidade = useMemo(
    () =>
      detalhe !== null && valuation !== null
        ? oportunidadeDeCompra(detalhe.precoAtual, valuation.precoTeto, valuation.margemSeguranca)
        : false,
    [detalhe, valuation],
  )

  const titulo = detalhe ? (
    <span className="flex flex-wrap items-center gap-2">
      {oportunidade ? (
        <span
          role="img"
          aria-label="Oportunidade de compra"
          title="Oportunidade de compra — cotação atingiu o alvo"
          className="text-base leading-none"
        >
          🎯
        </span>
      ) : null}
      <span className="font-mono">{detalhe.ticker}</span>
      <SeletorCategoriaTicker
        ticker={detalhe.ticker}
        categoria={detalhe.categoria}
        isSaving={alterandoCategoria}
        onChange={alterarCategoria}
      />
    </span>
  ) : null

  return (
    <Modal
      open={detalhe !== null}
      onClose={onClose}
      titulo={titulo}
      className="max-w-5xl"
      acoes={
        onAnterior && onProximo ? (
          <NavegacaoTickers
            onAnterior={onAnterior}
            onProximo={onProximo}
            posicao={posicaoNavegacao}
            total={totalNavegacao}
          />
        ) : null
      }
    >
      {detalhe ? (
        <div className="space-y-4">
          <BarraAbas aba={aba} onChange={setAba} contadores={contadores} />

          {erroCategoria ? <Alert variant="error">{erroCategoria}</Alert> : null}
          {avisoCategoria ? <Alert variant="success">{avisoCategoria}</Alert> : null}

          {aba === 'resumo' ? (
            <div
              role="tabpanel"
              id="painel-resumo"
              aria-labelledby="aba-resumo"
              className="space-y-4"
            >
              <DetalheAtivoResumo detalhe={detalhe} proventos={proventos} />
            </div>
          ) : null}

          {aba === 'operacoes' ? (
            <div role="tabpanel" id="painel-operacoes" aria-labelledby="aba-operacoes">
              <DetalheAtivoOperacoes
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                operacoes={operacoes}
                onChanged={onChanged}
              />
            </div>
          ) : null}

          {aba === 'proventos' ? (
            <div role="tabpanel" id="painel-proventos" aria-labelledby="aba-proventos">
              <DetalheAtivoProventos
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                proventos={proventos}
                onChanged={onChanged}
              />
            </div>
          ) : null}

          {aba === 'eventos' ? (
            <div role="tabpanel" id="painel-eventos" aria-labelledby="aba-eventos">
              <DetalheAtivoEventos
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                operacoes={operacoes}
                onChanged={onChanged}
              />
            </div>
          ) : null}

          {aba === 'valuation' ? (
            <div role="tabpanel" id="painel-valuation" aria-labelledby="aba-valuation">
              <DetalheAtivoValuation
                ticker={detalhe.ticker}
                categoria={detalhe.categoria}
                valuation={valuation}
                precoAtual={detalhe.precoAtual}
                onChanged={onChanged}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

/**
 * Botões de navegação entre os tickers da carteira, exibidos no lado direito do
 * cabeçalho do modal (mesma ordem da tabela de ativos).
 */
function NavegacaoTickers({
  onAnterior,
  onProximo,
  posicao,
  total,
}: {
  onAnterior: () => void
  onProximo: () => void
  posicao?: number
  total?: number
}) {
  const contador = posicao && total ? ` (${posicao} de ${total})` : ''
  const botaoClass =
    'rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Navegação entre ativos">
      <button
        type="button"
        onClick={onAnterior}
        aria-label={`Ativo anterior${contador}`}
        title="Ativo anterior"
        className={botaoClass}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onProximo}
        aria-label={`Próximo ativo${contador}`}
        title="Próximo ativo"
        className={botaoClass}
      >
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  )
}

/**
 * Seletor da categoria do ticker exibido no cabeçalho do modal. Trocar o valor
 * dispara a atualização da categoria de **todas** as operações do ativo (RF10).
 */
function SeletorCategoriaTicker({
  ticker,
  categoria,
  isSaving,
  onChange,
}: {
  ticker: string
  categoria: CategoriaAtivo
  isSaving: boolean
  onChange: (categoria: CategoriaAtivo) => void
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 focus-within:ring-2 focus-within:ring-brand-500/40">
      <span className="sr-only">Categoria de {ticker}</span>
      <select
        value={categoria}
        disabled={isSaving}
        onChange={(event) => onChange(event.target.value as CategoriaAtivo)}
        className="cursor-pointer rounded-full bg-transparent pr-0.5 text-xs font-medium text-slate-700 focus:outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {(Object.values(CategoriaAtivo) as CategoriaAtivo[]).map((value) => (
          <option key={value} value={value}>
            {CATEGORIA_ATIVO_LABELS[value]}
          </option>
        ))}
      </select>
      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
    </label>
  )
}

interface BarraAbasProps {
  aba: AbaId
  onChange: (aba: AbaId) => void
  contadores: { operacoes: number; proventos: number; eventos: number }
}

/** Barra de abas acessível (`role="tablist"`) com contagem por lista. */
function BarraAbas({ aba, onChange, contadores }: BarraAbasProps) {
  const abas: readonly { id: AbaId; rotulo: string; contagem?: number }[] = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'operacoes', rotulo: 'Operações', contagem: contadores.operacoes },
    { id: 'proventos', rotulo: 'Proventos', contagem: contadores.proventos },
    { id: 'eventos', rotulo: 'Eventos', contagem: contadores.eventos },
    { id: 'valuation', rotulo: 'Informações de Valuation' },
  ]

  return (
    <div
      role="tablist"
      aria-label="Seções do ativo"
      className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
    >
      {abas.map((item) => {
        const ativa = aba === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`aba-${item.id}`}
            aria-selected={ativa}
            aria-controls={`painel-${item.id}`}
            onClick={() => onChange(item.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
              ativa ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {item.rotulo}
            {item.contagem !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  ativa ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600',
                )}
              >
                {item.contagem}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Aba **Resumo** do modal: métricas do ativo, proventos do período, as duas
 * visões de rentabilidade e os gráficos (decomposição do retorno e proventos
 * por mês).
 */
export function DetalheAtivoResumo({
  detalhe,
  proventos,
}: {
  detalhe: DetalheAtivo
  proventos: readonly Provento[]
}) {
  const periodo =
    detalhe.primeiraCompra
      ? `de ${formatarDataBR(detalhe.primeiraCompra)} até hoje`
      : 'sem compras registradas'

  // A Rentabilidade Total só agrega quando há lucro realizado (vendas de ciclos
  // encerrados) ou quando a posição foi totalmente vendida — nesse caso a
  // Rentabilidade da posição (que depende da posição atual) não se aplica.
  const possuiRealizado = detalhe.lucroRealizado !== 0 && detalhe.capitalAportado > 0
  const mostrarTotal = possuiRealizado || detalhe.posicaoEncerrada
  const mostrarPosicao = !detalhe.posicaoEncerrada

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metrica rotulo="Menor compra" valor={formatarCentavosOuTraco(detalhe.menorPrecoCompra)} />
        <Metrica rotulo="Maior compra" valor={formatarCentavosOuTraco(detalhe.maiorPrecoCompra)} />
        <Metrica rotulo="Preço médio" valor={formatarCentavos(detalhe.precoMedio)} />
        <Metrica rotulo="Preço atual" valor={formatarCentavos(detalhe.precoAtual)} />
        <Metrica rotulo="Valor investido" valor={formatarCentavos(detalhe.valorInvestido)} />
        <Metrica rotulo="Valor atual" valor={formatarCentavos(detalhe.valorAtual)} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Proventos no período</p>
        <p className="text-lg font-semibold tabular-nums text-slate-900">
          {formatarCentavos(detalhe.proventosNoPeriodo)}
        </p>
        <p className="text-xs text-slate-500">{periodo}</p>
      </div>

      <div className={cn('grid gap-3', possuiRealizado && mostrarPosicao && 'sm:grid-cols-2')}>
        {mostrarPosicao ? (
          <div className="rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Rentabilidade da posição</p>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  classeValor(detalhe.rentabilidadePercent),
                )}
              >
                {formatarPercentual(detalhe.rentabilidadePercent)}
              </span>
              <span
                className={cn(
                  'text-sm font-medium tabular-nums',
                  classeValor(detalhe.retornoPosicao),
                )}
              >
                {formatarCentavos(detalhe.retornoPosicao)}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              (valor atual − investido + proventos) ÷ investido
            </p>
          </div>
        ) : null}

        {mostrarTotal ? (
          <div className="rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Rentabilidade Total</p>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  classeValor(detalhe.retornoTotal),
                )}
              >
                {formatarPercentual(detalhe.rentabilidadeTotalPercent)}
              </span>
              <span
                className={cn('text-sm font-medium tabular-nums', classeValor(detalhe.retornoTotal))}
              >
                {formatarCentavos(detalhe.retornoTotal)}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              realizado {formatarCentavos(detalhe.lucroRealizado)} + variação{' '}
              {formatarCentavos(detalhe.lucroFlutuante)} + proventos{' '}
              {formatarCentavos(detalhe.proventosNoPeriodo)}
            </p>
            <p className="text-xs text-slate-500">
              ÷ capital aportado ({formatarCentavos(detalhe.capitalAportado)})
            </p>
          </div>
        ) : null}
      </div>

      {mostrarTotal ? (
        <details className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Como é calculada a Rentabilidade Total?
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              A Rentabilidade Total considera o lucro de ciclos já encerrados (vendas), que a
              rentabilidade da posição não isola.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Retorno Total = Lucro Realizado + Variação + Proventos</li>
              <li>Rentabilidade Total = (Retorno Total ÷ Capital Aportado) × 100</li>
            </ul>
            <p>
              Capital aportado é a soma de todas as compras (quantidade × preço + taxas). Sem vendas,
              ele é igual ao valor investido e a Rentabilidade Total coincide com a da posição.
            </p>
            {detalhe.posicaoEncerrada ? (
              <p>
                A posição deste ativo foi totalmente vendida, por isso não há mais Rentabilidade da
                posição: o "Valor investido" exibido é o capital aportado nas compras.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="border-t border-slate-200 pt-4">
        <Suspense fallback={<GraficosFallback />}>
          <DetalheAtivoGraficos detalhe={detalhe} proventos={proventos} />
        </Suspense>
      </div>
    </div>
  )
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-900">{valor}</p>
    </div>
  )
}

function GraficosFallback() {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando gráficos…
      </span>
    </div>
  )
}
