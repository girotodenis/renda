import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { categoriaLabel, permiteMarcacaoManual } from '@/lib/categoria'
import { cn } from '@/lib/cn'
import { STATUS_COTACAO_LABELS } from '@/lib/cotacoes'
import type { CotacaoResolvida } from '@/lib/cotacoes'
import type { CategoriaAtivo, Consolidado } from '@/types/domain'
import { agruparAtivosParaTabela } from '@/lib/dashboard'
import type { GrupoCategoriaTabela } from '@/lib/dashboard'
import {
  classeValor,
  formatarCentavos,
  formatarPercentual,
} from '@/features/dashboard/formatters'

interface TabelaAtivosProps {
  /**
   * Consolidado da carteira (RF10). A tabela separa, por categoria, as posições
   * abertas (quantidade > 0) dos ativos **completamente vendidos** (quantidade
   * = 0), cada conjunto em sua própria aba.
   */
  consolidado: Consolidado[]
  /** Cotações resolvidas por ticker (fonte + status — RF19/RNF04). */
  cotacoes?: ReadonlyMap<string, CotacaoResolvida>
  /**
   * Tickers com oportunidade de compra (alerta de valuation). Quando um ticker
   * pertence ao conjunto, um ícone 🎯 é exibido à esquerda do seu nome.
   */
  oportunidades?: ReadonlySet<string>
  /**
   * Callback ao clicar no ticker de um ativo (abre o detalhe — RF10).
   * Quando ausente, o ticker é exibido como texto simples (sem interação).
   */
  onSelecionarAtivo?: (ticker: string) => void
  /**
   * Callback ao clicar no botão **+** ao lado do nome da categoria (abre o
   * cadastro de operação com a categoria travada). Quando ausente, o botão não
   * é exibido.
   */
  onNovaOperacao?: (categoria: CategoriaAtivo) => void
  /**
   * Callback ao clicar no botão de **marcação manual do valor atual**, exibido
   * ao lado do ticker de ativos de Renda Fixa / Tesouro Direto (RF19). Quando
   * ausente, o botão não é exibido.
   */
  onEditarValorManual?: (ticker: string, categoria: CategoriaAtivo) => void
}

/**
 * Tabela de ativos da carteira (RF10): uma tabela por categoria, cada uma com
 * um **consolidador** no topo (investido, valor atual, lucro e % da carteira) e
 * duas abas — **Em carteira** (posições com quantidade > 0) e **Vendidos**
 * (ativos já zerados, ou seja, completamente vendidos).
 */
export function TabelaAtivos({
  consolidado,
  cotacoes,
  oportunidades,
  onSelecionarAtivo,
  onNovaOperacao,
  onEditarValorManual,
}: TabelaAtivosProps) {
  const grupos = useMemo(() => agruparAtivosParaTabela(consolidado), [consolidado])

  if (grupos.length === 0) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Meus ativos</h2>
        </div>
        <p className="px-4 py-6 text-sm text-slate-500">
          Lance operações para visualizar seus ativos aqui.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {grupos.map((grupo) => (
        <CategoriaAtivos
          key={grupo.categoria}
          grupo={grupo}
          cotacoes={cotacoes}
          oportunidades={oportunidades}
          onSelecionarAtivo={onSelecionarAtivo}
          onNovaOperacao={onNovaOperacao}
          onEditarValorManual={onEditarValorManual}
        />
      ))}
    </div>
  )
}

type AbaCategoria = 'posicoes' | 'vendidos'

function CategoriaAtivos({
  grupo,
  cotacoes,
  oportunidades,
  onSelecionarAtivo,
  onNovaOperacao,
  onEditarValorManual,
}: {
  grupo: GrupoCategoriaTabela
  cotacoes?: ReadonlyMap<string, CotacaoResolvida>
  oportunidades?: ReadonlySet<string>
  onSelecionarAtivo?: (ticker: string) => void
  onNovaOperacao?: (categoria: CategoriaAtivo) => void
  onEditarValorManual?: (ticker: string, categoria: CategoriaAtivo) => void
}) {
  const [abaSelecionada, setAbaSelecionada] = useState<AbaCategoria>('posicoes')
  const temAbertos = grupo.abertos.length > 0
  const temEncerrados = grupo.encerrados.length > 0
  // Sem posições abertas, abre direto na aba de ativos vendidos.
  const aba: AbaCategoria = !temAbertos && temEncerrados ? 'vendidos' : abaSelecionada

  const idBase = `ativos-${grupo.categoria}`
  const rotulo = categoriaLabel(grupo.categoria)

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">{rotulo}</h2>
          {onNovaOperacao ? (
            <button
              type="button"
              onClick={() => onNovaOperacao(grupo.categoria)}
              aria-label={`Nova operação em ${rotulo}`}
              title={`Nova operação em ${rotulo}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-brand-200 bg-brand-50 text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <span className="text-sm text-slate-500">
          {grupo.abertos.length} {grupo.abertos.length === 1 ? 'posição' : 'posições'}
        </span>
      </header>

      <div
        role="tablist"
        aria-label={`Visões de ${rotulo}`}
        className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2"
      >
        <AbaBotao
          id={`${idBase}-tab-posicoes`}
          controls={`${idBase}-panel-posicoes`}
          ativa={aba === 'posicoes'}
          onClick={() => setAbaSelecionada('posicoes')}
        >
          Em carteira
          <ContadorBadge quantidade={grupo.abertos.length} />
        </AbaBotao>
        <AbaBotao
          id={`${idBase}-tab-vendidos`}
          controls={`${idBase}-panel-vendidos`}
          ativa={aba === 'vendidos'}
          onClick={() => setAbaSelecionada('vendidos')}
        >
          Vendidos
          <ContadorBadge quantidade={grupo.encerrados.length} />
        </AbaBotao>
      </div>

      {aba === 'posicoes' ? (
        <div
          role="tabpanel"
          id={`${idBase}-panel-posicoes`}
          aria-labelledby={`${idBase}-tab-posicoes`}
        >
          {temAbertos ? (
            <>
              <ConsolidadorCategoria grupo={grupo} />
              <TabelaPosicoes
                categoria={grupo.categoria}
                ativos={grupo.abertos}
                cotacoes={cotacoes}
                oportunidades={oportunidades}
                onSelecionarAtivo={onSelecionarAtivo}
                onEditarValorManual={onEditarValorManual}
              />
            </>
          ) : (
            <p className="px-4 py-6 text-sm text-slate-500">
              Você não possui posições em carteira em {rotulo}.
            </p>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${idBase}-panel-vendidos`}
          aria-labelledby={`${idBase}-tab-vendidos`}
        >
          {temEncerrados ? (
            <TabelaEncerrados encerrados={grupo.encerrados} onSelecionarAtivo={onSelecionarAtivo} />
          ) : (
            <p className="px-4 py-6 text-sm text-slate-500">
              Nenhum ativo de {rotulo} foi completamente vendido.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** Botão de aba (tab) com estado ativo e rótulo acessível. */
function AbaBotao({
  id,
  controls,
  ativa,
  onClick,
  children,
}: {
  id: string
  controls: string
  ativa: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={ativa}
      aria-controls={controls}
      tabIndex={ativa ? 0 : -1}
      onClick={onClick}
      className={cn(
        '-mb-px inline-flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-sm font-semibold transition-colors',
        ativa
          ? 'border-slate-200 bg-white text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  )
}

/** Contador (badge) exibido no rótulo das abas. */
function ContadorBadge({ quantidade }: { quantidade: number }) {
  return (
    <span className="inline-flex min-w-5 justify-center rounded-full bg-slate-200 px-1.5 text-xs font-semibold tabular-nums text-slate-700">
      {quantidade}
    </span>
  )
}

/** Consolidador da categoria (totais das posições abertas). */
function ConsolidadorCategoria({ grupo }: { grupo: GrupoCategoriaTabela }) {
  return (
    <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-100 sm:grid-cols-4">
      <ConsolidadoCell rotulo="Investido" valor={formatarCentavos(grupo.totalInvestido)} />
      <ConsolidadoCell rotulo="Valor atual" valor={formatarCentavos(grupo.valorAtual)} />
      <ConsolidadoCell
        rotulo="Lucro"
        valor={formatarCentavos(grupo.lucroPrejuizo)}
        classe={classeValor(grupo.lucroPrejuizo)}
        sub={formatarPercentual(grupo.lucroPrejuizoPercent)}
      />
      <ConsolidadoCell rotulo="% da carteira" valor={formatarPercentual(grupo.percentualCarteira)} />
    </div>
  )
}

/** Aba **Em carteira**: posições abertas (quantidade > 0). */
function TabelaPosicoes({
  categoria,
  ativos,
  cotacoes,
  oportunidades,
  onSelecionarAtivo,
  onEditarValorManual,
}: {
  categoria: CategoriaAtivo
  ativos: Consolidado[]
  cotacoes?: ReadonlyMap<string, CotacaoResolvida>
  oportunidades?: ReadonlySet<string>
  onSelecionarAtivo?: (ticker: string) => void
  onEditarValorManual?: (ticker: string, categoria: CategoriaAtivo) => void
}) {
  const rotulo = categoriaLabel(categoria)
  const podeMarcarValor = permiteMarcacaoManual(categoria)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Posições de {rotulo} com preço médio, cotação atual, total investido, valor total,
          lucro e variação.
        </caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Quantidade</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Preço Médio</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Cotação Atual</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Total Investido</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Valor Total</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Lucro</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Variação</th>
          </tr>
        </thead>
        <tbody>
          {ativos.map((ativo) => {
            const cotacao = cotacoes?.get(ativo.ticker)
            return (
              <tr key={ativo.ticker} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    {oportunidades?.has(ativo.ticker.trim().toUpperCase()) ? (
                      <span
                        role="img"
                        aria-label="Oportunidade de compra"
                        title="Oportunidade de compra — cotação atingiu o alvo"
                        className="text-base leading-none"
                      >
                        🎯
                      </span>
                    ) : null}
                    <TickerBotao ticker={ativo.ticker} onSelecionarAtivo={onSelecionarAtivo} />
                    {onEditarValorManual && podeMarcarValor ? (
                      <button
                        type="button"
                        onClick={() => onEditarValorManual(ativo.ticker, categoria)}
                        aria-label={`Informar valor atual de ${ativo.ticker}`}
                        title="Informar valor atual (marcação manual)"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {ativo.quantidadeAtual.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {formatarCentavos(ativo.precoMedio)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  <span className="block">{formatarCentavos(ativo.precoAtual)}</span>
                  {cotacao && cotacao.status !== 'disponivel' ? (
                    <CotacaoSelo status={cotacao.status} />
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {formatarCentavos(ativo.totalInvestido)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                  {formatarCentavos(ativo.valorAtual)}
                </td>
                <td
                  className={cn(
                    'px-4 py-2 text-right tabular-nums font-medium',
                    classeValor(ativo.lucroPrejuizo),
                  )}
                >
                  <span className="block">{formatarCentavos(ativo.lucroPrejuizo)}</span>
                  <span className="block text-xs">
                    {formatarPercentual(ativo.lucroPrejuizoPercent)}
                  </span>
                </td>
                {/* Variação de preço: (preço atual − preço médio) ÷ preço médio = lucroPrejuizoPercent. */}
                <td
                  className={cn(
                    'px-4 py-2 text-right tabular-nums font-medium',
                    classeValor(ativo.lucroPrejuizoPercent),
                  )}
                >
                  {formatarPercentual(ativo.lucroPrejuizoPercent)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Aba **Vendidos**: ativos com posição totalmente encerrada (quantidade = 0).
 * O ticker permanece clicável para abrir o histórico e o resultado realizado.
 */
function TabelaEncerrados({
  encerrados,
  onSelecionarAtivo,
}: {
  encerrados: Consolidado[]
  onSelecionarAtivo?: (ticker: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Ativos completamente vendidos: tickers com posição zerada. Clique no ticker para ver o
          histórico e o resultado realizado.
        </caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Quantidade</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Situação</th>
          </tr>
        </thead>
        <tbody>
          {encerrados.map((ativo) => (
            <tr key={ativo.ticker} className="border-t border-slate-100">
              <td className="px-4 py-2">
                <TickerBotao ticker={ativo.ticker} onSelecionarAtivo={onSelecionarAtivo} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-500">0</td>
              <td className="px-4 py-2 text-right">
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Encerrada
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Ticker clicável (abre o detalhe) ou texto simples quando sem interação. */
function TickerBotao({
  ticker,
  onSelecionarAtivo,
}: {
  ticker: string
  onSelecionarAtivo?: (ticker: string) => void
}) {
  if (!onSelecionarAtivo) {
    return <span className="font-mono font-medium text-slate-900">{ticker}</span>
  }
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onSelecionarAtivo(ticker)}
      className="rounded font-mono font-medium text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {ticker}
    </button>
  )
}

/** Célula do consolidador (rótulo + valor, com sub e cor opcionais). */
function ConsolidadoCell({
  rotulo,
  valor,
  sub,
  classe,
}: {
  rotulo: string
  valor: string
  sub?: string
  classe?: string
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={cn('text-sm font-semibold tabular-nums text-slate-900', classe)}>{valor}</p>
      {sub ? <p className={cn('text-xs tabular-nums', classe)}>{sub}</p> : null}
    </div>
  )
}

/** Selo acessível com a fonte/estado da cotação (RF19/RNF04). */
function CotacaoSelo({ status }: { status: 'manual' | 'estimada' | 'indisponivel' }) {
  const indisponivel = status === 'indisponivel'
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        indisponivel ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600',
      )}
      title={
        indisponivel
          ? 'Cotação indisponível — exibindo o preço médio como referência.'
          : 'Preço informado manualmente ou estimado.'
      }
    >
      {STATUS_COTACAO_LABELS[status]}
    </span>
  )
}
