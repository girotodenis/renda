import { round2 } from '@/lib/money'
import { EVENTO_CORPORATIVO_TIPOS, OperacaoTipo } from '@/types/domain'
import type { CategoriaAtivo, EventoCorporativoTipo, Operacao } from '@/types/domain'

/**
 * Eventos corporativos (RF20, Seção 5.6) — módulo **puro** e testável.
 *
 * Um evento corporativo **não gera lucro/prejuízo**: apenas ajusta a quantidade
 * e o preço médio de um ativo, preservando o **total investido**.
 *
 * - Desdobramento (split) `1:N`: `Qtd × N` e `Preço Médio / N`.
 * - Grupamento `N:1`: `Qtd / N` e `Preço Médio × N`.
 * - Bonificação `x%`: `Qtd × (1 + x/100)` e `Preço Médio / (1 + x/100)`.
 *
 * Convenção de persistência (aba `Operacoes`, sem coluna extra): o **fator do
 * evento** é gravado na coluna `Quantidade` (`N` para split/grupamento, `x`
 * percentual para bonificação) e `Preço Unitário`/`Taxas` ficam em `0`.
 */

export type { EventoCorporativoTipo }
export { EVENTO_CORPORATIVO_TIPOS }

/** Evento corporativo aplicado a um ticker. */
export interface EventoCorporativo {
  /** UUID/timestamp — nunca reutilizado. */
  id: string
  /** ISO `YYYY-MM-DD`. */
  data: string
  ticker: string
  categoria: CategoriaAtivo
  tipo: EventoCorporativoTipo
  /**
   * Parâmetro do evento:
   * - `Split`: fator `N` (ex.: `2` para 1:2).
   * - `Grupamento`: fator `N` (ex.: `10` para 10:1).
   * - `Bonificacao`: percentual `x` (ex.: `10` para 10%).
   */
  valor: number
}

/** Posição mínima necessária para aplicar um evento. */
export interface PosicaoAjustavel {
  /** Quantidade atual (compras − vendas). */
  quantidadeAtual: number
  /** Preço médio em **centavos**. */
  precoMedio: number
}

/** Resultado da aplicação de um evento (total investido preservado). */
export interface PosicaoAjustada {
  quantidadeAtual: number
  precoMedio: number
  /** Total investido em **centavos** (invariante sob eventos corporativos). */
  totalInvestido: number
}

/** Rótulos de exibição (pt-BR) por tipo de evento. */
export const EVENTO_CORPORATIVO_LABELS: Record<EventoCorporativoTipo, string> = {
  [OperacaoTipo.Split]: 'Desdobramento (split)',
  [OperacaoTipo.Grupamento]: 'Grupamento',
  [OperacaoTipo.Bonificacao]: 'Bonificação',
}

/** Rótulo do campo `valor` conforme o tipo do evento. */
export const EVENTO_CORPORATIVO_VALOR_LABELS: Record<EventoCorporativoTipo, string> = {
  [OperacaoTipo.Split]: 'Fator do split (1:N)',
  [OperacaoTipo.Grupamento]: 'Fator do grupamento (N:1)',
  [OperacaoTipo.Bonificacao]: 'Percentual da bonificação (%)',
}

/** `true` quando o tipo de operação é um evento corporativo. */
export function isTipoEventoCorporativo(tipo: OperacaoTipo): tipo is EventoCorporativoTipo {
  return (EVENTO_CORPORATIVO_TIPOS as readonly OperacaoTipo[]).includes(tipo)
}

/**
 * Fator multiplicador da **quantidade** do evento. O preço médio é o custo
 * total dividido pela nova quantidade, o que mantém o total investido.
 */
export function fatorQuantidade(tipo: EventoCorporativoTipo, valor: number): number {
  if (!Number.isFinite(valor) || valor <= 0) return 1
  switch (tipo) {
    case OperacaoTipo.Split:
      return valor
    case OperacaoTipo.Grupamento:
      return 1 / valor
    case OperacaoTipo.Bonificacao:
      return 1 + valor / 100
    default:
      return 1
  }
}

/** Fator composto de uma sequência de eventos (a ordem não altera o resultado). */
export function fatorComposto(eventos: readonly EventoCorporativo[]): number {
  return eventos.reduce((fator, evento) => fator * fatorQuantidade(evento.tipo, evento.valor), 1)
}

/** Descrição curta (pt-BR) do evento, ex.: `Split 1:2` ou `Bonificação 10%`. */
export function descreverEvento(evento: EventoCorporativo): string {
  switch (evento.tipo) {
    case OperacaoTipo.Split:
      return `Split 1:${formatarNumero(evento.valor)}`
    case OperacaoTipo.Grupamento:
      return `Grupamento ${formatarNumero(evento.valor)}:1`
    case OperacaoTipo.Bonificacao:
      return `Bonificação ${formatarNumero(evento.valor)}%`
    default:
      return EVENTO_CORPORATIVO_LABELS[evento.tipo]
  }
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
}

/** Aplica um único evento a uma posição, preservando o total investido. */
export function aplicarEvento(
  posicao: PosicaoAjustavel,
  evento: EventoCorporativo,
): PosicaoAjustada {
  return aplicarFator(posicao, fatorQuantidade(evento.tipo, evento.valor))
}

/** Aplica uma sequência de eventos a uma posição (ordem independente). */
export function aplicarEventos(
  posicao: PosicaoAjustavel,
  eventos: readonly EventoCorporativo[],
): PosicaoAjustada {
  return aplicarFator(posicao, fatorComposto(eventos))
}

function aplicarFator(posicao: PosicaoAjustavel, fator: number): PosicaoAjustada {
  const quantidadeAtual = round2(posicao.quantidadeAtual * fator)
  const custoTotal = round2(posicao.quantidadeAtual * posicao.precoMedio)
  const precoMedio = quantidadeAtual === 0 ? 0 : round2(custoTotal / quantidadeAtual)
  return {
    quantidadeAtual,
    precoMedio,
    totalInvestido: round2(quantidadeAtual * precoMedio),
  }
}

/** Valida um evento. Retorna a mensagem de erro (pt-BR) ou `null` se válido. */
export function validarEvento(evento: EventoCorporativo): string | null {
  if (evento.ticker.trim().length === 0) return 'Informe o ticker do ativo.'
  if (!Number.isFinite(evento.valor) || evento.valor <= 0) {
    return 'O fator/percentual do evento deve ser maior que zero.'
  }
  if (evento.tipo === OperacaoTipo.Split && evento.valor <= 1) {
    return 'O fator do split deve ser maior que 1 (ex.: 2 para 1:2).'
  }
  if (evento.tipo === OperacaoTipo.Grupamento && evento.valor <= 1) {
    return 'O fator do grupamento deve ser maior que 1 (ex.: 10 para 10:1).'
  }
  if (evento.tipo === OperacaoTipo.Bonificacao && evento.valor >= 1000) {
    return 'O percentual da bonificação parece inválido.'
  }
  return null
}

/** Agrupa eventos por ticker (mapa `ticker → eventos`), preservando a ordem. */
export function agruparEventosPorTicker(
  eventos: readonly EventoCorporativo[],
): Map<string, EventoCorporativo[]> {
  const mapa = new Map<string, EventoCorporativo[]>()
  for (const evento of eventos) {
    const ticker = evento.ticker.trim()
    if (ticker.length === 0) continue
    const lista = mapa.get(ticker)
    if (lista) lista.push(evento)
    else mapa.set(ticker, [evento])
  }
  return mapa
}

/** Converte um evento corporativo em uma linha da aba `Operacoes`. */
export function eventoParaOperacao(evento: EventoCorporativo): Operacao {
  return {
    id: evento.id,
    data: evento.data,
    tipo: evento.tipo,
    categoria: evento.categoria,
    ticker: evento.ticker.trim().toUpperCase(),
    quantidade: evento.valor,
    precoUnitario: 0,
    taxas: 0,
    indexador: null,
    percentualIndexador: null,
    vencimento: null,
    valorBrutoAtual: null,
  }
}

/** Converte uma linha da aba `Operacoes` em um evento corporativo. */
export function eventoDeOperacao(operacao: Operacao): EventoCorporativo | null {
  if (!isTipoEventoCorporativo(operacao.tipo)) return null
  return {
    id: operacao.id,
    data: operacao.data,
    ticker: operacao.ticker,
    categoria: operacao.categoria,
    tipo: operacao.tipo,
    valor: operacao.quantidade,
  }
}

/** Extrai apenas os eventos corporativos de uma lista de operações. */
export function eventosDeOperacoes(operacoes: readonly Operacao[]): EventoCorporativo[] {
  const eventos: EventoCorporativo[] = []
  for (const operacao of operacoes) {
    const evento = eventoDeOperacao(operacao)
    if (evento) eventos.push(evento)
  }
  return eventos
}
