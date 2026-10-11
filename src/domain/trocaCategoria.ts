import type { CategoriaAtivo, MetaRebalanceamento, Operacao, Provento } from '@/types/domain'

/**
 * Troca de categoria de um ticker — módulo **puro** e testável.
 *
 * A troca de categoria no modal do ativo (RF10) precisa propagar a nova
 * categoria para todos os registros do ticker nas três abas que guardam
 * categoria: `Operacoes`, `Proventos` e `Metas_Rebalanceamento`. A persistência
 * fica a cargo dos casos de uso da aplicação; aqui ficam apenas as regras
 * puras de transformação.
 */

/** Entidade que possui ticker (operação, provento ou meta). */
interface ComTicker {
  ticker: string
}

/** Entidade com ticker e categoria — alvo da troca. */
type ComCategoria = ComTicker & { categoria: CategoriaAtivo }

/** Normaliza o ticker para comparação (sem caixa nem espaços nas pontas). */
function normalizarTicker(ticker: string): string {
  return ticker.trim().toUpperCase()
}

/** `true` quando o item pertence ao ticker informado (comparação tolerante). */
export function ehDoTicker(item: ComTicker, ticker: string): boolean {
  const alvo = normalizarTicker(ticker)
  return alvo.length > 0 && normalizarTicker(item.ticker) === alvo
}

/** Resultado da troca de categoria sobre uma coleção de itens. */
export interface TrocaCategoriaResultado<T> {
  /** Itens na ordem original, com a categoria atualizada. */
  itens: T[]
  /** Quantidade de itens efetivamente alterados. */
  atualizadas: number
}

/**
 * Núcleo da troca: aplica `categoria` a todos os itens do ticker (comparação
 * ignorando caixa e espaços). Itens que já estão na categoria de destino são
 * preservados (mesma referência). Linhas de classe do rebalanceamento
 * (`ticker = '#Classe'`) nunca correspondem a um ticker real e ficam intactas.
 */
function trocarCategoria<T extends ComCategoria>(
  itens: readonly T[],
  ticker: string,
  categoria: CategoriaAtivo,
): TrocaCategoriaResultado<T> {
  const alvo = normalizarTicker(ticker)
  let atualizadas = 0

  const proximos = itens.map((item): T => {
    if (alvo.length === 0 || normalizarTicker(item.ticker) !== alvo) return item
    if (item.categoria === categoria) return item
    atualizadas += 1
    return { ...item, categoria }
  })

  return { itens: proximos, atualizadas }
}

/** Troca a categoria de todas as **operações** do ticker. */
export function atualizarCategoriaDeOperacoes(
  operacoes: readonly Operacao[],
  ticker: string,
  categoria: CategoriaAtivo,
): { operacoes: Operacao[]; atualizadas: number } {
  const { itens, atualizadas } = trocarCategoria(operacoes, ticker, categoria)
  return { operacoes: itens, atualizadas }
}

/** Troca a categoria de todos os **proventos** do ticker. */
export function atualizarCategoriaDeProventos(
  proventos: readonly Provento[],
  ticker: string,
  categoria: CategoriaAtivo,
): { proventos: Provento[]; atualizadas: number } {
  const { itens, atualizadas } = trocarCategoria(proventos, ticker, categoria)
  return { proventos: itens, atualizadas }
}

/** Troca a categoria das **metas** do ticker (linhas de ticker, não de classe). */
export function atualizarCategoriaDeMetas(
  metas: readonly MetaRebalanceamento[],
  ticker: string,
  categoria: CategoriaAtivo,
): { metas: MetaRebalanceamento[]; atualizadas: number } {
  const { itens, atualizadas } = trocarCategoria(metas, ticker, categoria)
  return { metas: itens, atualizadas }
}
