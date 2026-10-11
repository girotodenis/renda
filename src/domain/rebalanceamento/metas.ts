import { round2 } from '@/domain/money'
import type { CategoriaAtivo } from '@/domain/entities'
import type { MetaInput } from './types'

/**
 * Conversão de nota → meta e normalização de metas por classe vs. ticker
 * (Seções 5.2 e 5.7) — funções **puras** e testáveis.
 *
 * Regra de prioridade: **ticker (override) > classe**. A meta individual
 * substitui a da classe para aquele ativo; o que sobra da meta da classe é
 * rateado entre os ativos sem meta individual, proporcionalmente às notas (ou
 * igualmente, quando não há notas). Ao final as metas são normalizadas para
 * somar exatamente **100%**.
 */

/**
 * Marca uma linha de **meta de classe** na aba `Metas_Rebalanceamento`.
 *
 * A planilha não possui uma coluna dedicada para metas por classe (Seção 2);
 * usamos uma linha reservada cujo `Ticker` recebe este marcador e cuja coluna
 * `Categoria` identifica a classe, gravando a meta em `Meta %`.
 */
export const CLASSE_MARKER = '#Classe'

/** `true` quando o ticker é a linha reservada de meta de classe. */
export function isLinhaDeClasse(ticker: string): boolean {
  return ticker.trim() === CLASSE_MARKER
}

interface PesoMeta {
  ticker: string
  /** Peso relativo (nota, meta individual ou orçamento da classe). */
  peso: number
}

/**
 * Converte pesos relativos em percentuais que somam **exatamente 100%**
 * (arredondados a 2 casas), distribuindo o resíduo do arredondamento pelo
 * método do maior resto. Sem pesos positivos, distribui igualmente (100/n).
 */
function distribuirPercentual(pesos: readonly PesoMeta[]): Map<string, number> {
  const resultado = new Map<string, number>()
  if (pesos.length === 0) return resultado

  const total = pesos.reduce((acc, item) => acc + Math.max(0, item.peso), 0)
  const base = pesos.map((item) => ({
    ticker: item.ticker,
    // Em basis points (0,01%) para a soma fechar inteira em 10000.
    bruto: total > 0 ? (Math.max(0, item.peso) / total) * 10000 : 10000 / pesos.length,
  }))

  const pisos = base.map((item) => Math.floor(item.bruto))
  let sobra = 10000 - pisos.reduce((acc, valor) => acc + valor, 0)

  const ordem = base
    .map((item, index) => ({ index, fracao: item.bruto - Math.floor(item.bruto) }))
    .sort((a, b) => b.fracao - a.fracao || a.index - b.index)

  for (const { index } of ordem) {
    if (sobra <= 0) break
    pisos[index] += 1
    sobra -= 1
  }

  base.forEach((item, index) => {
    resultado.set(item.ticker, round2(pisos[index] / 100))
  })
  return resultado
}

/**
 * Converte notas (0–10) em **metas percentuais** (Seção 5.2).
 *
 * `Meta%[i] = (Nota[i] / Σ Nota[j]) × 100`. Se `Σ Nota == 0`, distribui
 * igualmente (`100/n`).
 */
export function converterNotasEmMetas(
  itens: ReadonlyArray<{ ticker: string; nota: number }>,
): Record<string, number> {
  const validos = itens
    .map((item) => ({ ticker: item.ticker.trim(), nota: Math.max(0, item.nota) }))
    .filter((item) => item.ticker.length > 0 && !isLinhaDeClasse(item.ticker))

  return Object.fromEntries(
    distribuirPercentual(validos.map((item) => ({ ticker: item.ticker, peso: item.nota }))),
  )
}

/**
 * Normaliza as metas combinando classe e ticker (Seção 5.7).
 *
 * Para cada categoria: as metas individuais valem integralmente e descontam do
 * orçamento da classe; o restante do orçamento é rateado entre os ativos sem
 * meta individual (proporcional às notas ou igualmente). O resultado é
 * normalizado para somar 100% e devolvido como `Record<ticker, Meta%>`.
 */
export function normalizarMetas(itens: readonly MetaInput[]): Record<string, number> {
  // Dedupe por ticker (o último vence) e ignora linhas de classe/vazias.
  const porTicker = new Map<string, MetaInput>()
  for (const item of itens) {
    const ticker = item.ticker.trim()
    if (ticker.length === 0 || isLinhaDeClasse(ticker)) continue
    porTicker.set(ticker, { ...item, ticker })
  }
  const unicos = [...porTicker.values()]
  if (unicos.length === 0) return {}

  const porCategoria = new Map<CategoriaAtivo, MetaInput[]>()
  for (const item of unicos) {
    const lista = porCategoria.get(item.categoria) ?? []
    lista.push(item)
    porCategoria.set(item.categoria, lista)
  }

  const pesos = new Map<string, number>()
  for (const lista of porCategoria.values()) {
    const metaClasse = Math.max(0, lista[0]?.metaClasse ?? 0)
    let somaIndividuais = 0
    const semIndividual: MetaInput[] = []

    for (const item of lista) {
      const individual = item.metaIndividual
      if (individual !== undefined && individual !== null && individual > 0) {
        pesos.set(item.ticker, individual)
        somaIndividuais += individual
      } else {
        semIndividual.push(item)
      }
    }

    if (semIndividual.length > 0) {
      const orcamento = Math.max(0, metaClasse - somaIndividuais)
      const somaNotas = semIndividual.reduce((acc, item) => acc + Math.max(0, item.nota ?? 0), 0)
      for (const item of semIndividual) {
        const peso =
          somaNotas > 0
            ? (orcamento * Math.max(0, item.nota ?? 0)) / somaNotas
            : orcamento / semIndividual.length
        pesos.set(item.ticker, peso)
      }
    }
  }

  const normalizadas = distribuirPercentual(
    [...pesos.entries()].map(([ticker, peso]) => ({ ticker, peso })),
  )
  return Object.fromEntries(normalizadas)
}
