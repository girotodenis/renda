import { categoriaLabel } from '@/lib/categoria'
import { formatarDataBR, formatarMesAnoBR } from '@/lib/dates'
import { round2 } from '@/lib/money'
import { CategoriaAtivo } from '@/types/domain'
import type { Consolidado, Provento, Snapshot } from '@/types/domain'

/**
 * Agregações do dashboard (RF07–RF11) — módulo **puro** e testável.
 *
 * Nenhuma dependência de UI/rede: recebe o consolidado, os proventos e o
 * histórico já carregados (cache-first via repositórios) e devolve as séries
 * prontas para os gráficos e tabelas. Dinheiro sempre em **centavos**.
 */

/** Item de alocação (rosca/pizza — RF08). */
export interface AlocacaoItem {
  /** Chave estável (categoria ou ticker). */
  chave: string
  /** Rótulo de exibição (pt-BR). */
  rotulo: string
  /** Valor atual em **centavos**. */
  valor: number
  /** Participação no total (0–100). */
  percentual: number
}

/** Valor agregado de proventos por uma dimensão (RF11). */
export interface AgregadoProvento {
  /** Chave estável (ano, mês `YYYY-MM`, ticker ou tipo). */
  chave: string
  /** Rótulo de exibição (pt-BR). */
  rotulo: string
  /** Valor total em **centavos**. */
  valorTotal: number
}

/** Ponto da série de evolução patrimonial (RF09). */
export interface EvolucaoPonto {
  /** ISO `YYYY-MM-DD`. */
  data: string
  /** Rótulo de exibição `DD/MM/AAAA`. */
  rotulo: string
  patrimonioTotal: number
  totalInvestido: number
  lucroAcumulado: number
}

/** Posições efetivamente abertas (quantidade ≠ 0 e ticker preenchido). */
export function posicoesAbertas(consolidado: readonly Consolidado[]): Consolidado[] {
  return consolidado.filter(
    (linha) => linha.quantidadeAtual !== 0 && linha.ticker.trim().length > 0,
  )
}

/** Ativos para a tabela (RF10), ordenados por valor atual decrescente. */
export function ativosParaTabela(consolidado: readonly Consolidado[]): Consolidado[] {
  return [...posicoesAbertas(consolidado)].sort((a, b) => b.valorAtual - a.valorAtual)
}

/**
 * Posições **totalmente vendidas** (quantidade zerada e ticker preenchido) —
 * base da aba "Vendidos" das tabelas do dashboard.
 */
export function posicoesEncerradas(consolidado: readonly Consolidado[]): Consolidado[] {
  return consolidado.filter(
    (linha) => linha.quantidadeAtual === 0 && linha.ticker.trim().length > 0,
  )
}

/** Agrupamento das posições abertas de uma categoria, com totais consolidados. */
export interface GrupoCategoria {
  categoria: CategoriaAtivo
  /** Posições da categoria, ordenadas por valor atual decrescente. */
  ativos: Consolidado[]
  quantidadePosicoes: number
  /** Totais em **centavos**. */
  totalInvestido: number
  valorAtual: number
  lucroPrejuizo: number
  lucroPrejuizoPercent: number
  percentualCarteira: number
}

/**
 * Grupo de uma categoria na tabela do dashboard: separa as posições **abertas**
 * (quantidade > 0) dos ativos **completamente vendidos** (quantidade = 0), que
 * ganham uma aba própria. Os totais consideram apenas as posições abertas.
 */
export interface GrupoCategoriaTabela {
  categoria: CategoriaAtivo
  /** Posições abertas (quantidade ≠ 0), ordenadas por valor atual decrescente. */
  abertos: Consolidado[]
  /** Ativos totalmente vendidos (quantidade = 0), ordenados por ticker. */
  encerrados: Consolidado[]
  /** Totais em **centavos** (somente posições abertas). */
  totalInvestido: number
  valorAtual: number
  lucroPrejuizo: number
  lucroPrejuizoPercent: number
  percentualCarteira: number
}

/** Ordem canônica de exibição das categorias (Seção 2). */
const ORDEM_CATEGORIAS: readonly CategoriaAtivo[] = [
  CategoriaAtivo.Acao,
  CategoriaAtivo.Bdr,
  CategoriaAtivo.Etf,
  CategoriaAtivo.Fii,
  CategoriaAtivo.TesouroDireto,
  CategoriaAtivo.RendaFixa,
]

/**
 * Agrupa o consolidado por categoria (ordem canônica) para a tabela do
 * dashboard, separando as posições abertas dos ativos completamente vendidos e
 * calculando o consolidador de cada grupo (somente posições abertas): investido,
 * valor atual, lucro (R$ e %) e participação na carteira.
 */
export function agruparAtivosParaTabela(
  consolidado: readonly Consolidado[],
): GrupoCategoriaTabela[] {
  const abertos = posicoesAbertas(consolidado)
  const encerrados = posicoesEncerradas(consolidado)
  const totalCarteira = round2(abertos.reduce((soma, linha) => soma + linha.valorAtual, 0))

  const categorias = new Set<CategoriaAtivo>()
  for (const linha of abertos) categorias.add(linha.categoria)
  for (const linha of encerrados) categorias.add(linha.categoria)

  return ORDEM_CATEGORIAS.filter((categoria) => categorias.has(categoria)).map((categoria) => {
    const doAbertos = abertos
      .filter((linha) => linha.categoria === categoria)
      .sort((a, b) => b.valorAtual - a.valorAtual)
    const doEncerrados = encerrados
      .filter((linha) => linha.categoria === categoria)
      .sort((a, b) => a.ticker.localeCompare(b.ticker))

    const totalInvestido = round2(
      doAbertos.reduce((soma, ativo) => soma + ativo.totalInvestido, 0),
    )
    const valorAtual = round2(doAbertos.reduce((soma, ativo) => soma + ativo.valorAtual, 0))
    const lucroPrejuizo = round2(valorAtual - totalInvestido)
    return {
      categoria,
      abertos: doAbertos,
      encerrados: doEncerrados,
      totalInvestido,
      valorAtual,
      lucroPrejuizo,
      lucroPrejuizoPercent:
        totalInvestido === 0 ? 0 : round2((lucroPrejuizo / totalInvestido) * 100),
      percentualCarteira: totalCarteira === 0 ? 0 : round2((valorAtual / totalCarteira) * 100),
    }
  })
}

/**
 * Agrupa as posições abertas por categoria (ordem canônica), calculando o
 * consolidador de cada grupo: investido, valor atual, lucro (R$ e %) e
 * participação na carteira. Categorias sem posições abertas são omitidas.
 */
export function agruparAtivosPorCategoria(
  consolidado: readonly Consolidado[],
): GrupoCategoria[] {
  return agruparAtivosParaTabela(consolidado)
    .filter((grupo) => grupo.abertos.length > 0)
    .map((grupo) => ({
      categoria: grupo.categoria,
      ativos: grupo.abertos,
      quantidadePosicoes: grupo.abertos.length,
      totalInvestido: grupo.totalInvestido,
      valorAtual: grupo.valorAtual,
      lucroPrejuizo: grupo.lucroPrejuizo,
      lucroPrejuizoPercent: grupo.lucroPrejuizoPercent,
      percentualCarteira: grupo.percentualCarteira,
    }))
}

function montarAlocacao(
  entradas: Map<string, { rotulo: string; valor: number }>,
): AlocacaoItem[] {
  const total = [...entradas.values()].reduce((soma, entrada) => soma + entrada.valor, 0)
  return [...entradas.entries()]
    .map(([chave, entrada]) => ({
      chave,
      rotulo: entrada.rotulo,
      valor: round2(entrada.valor),
      percentual: total === 0 ? 0 : round2((entrada.valor / total) * 100),
    }))
    .filter((item) => item.valor > 0)
    .sort((a, b) => b.valor - a.valor)
}

/** Alocação por categoria (RF08) — apenas posições abertas com valor positivo. */
export function alocacaoPorCategoria(consolidado: readonly Consolidado[]): AlocacaoItem[] {
  const entradas = new Map<string, { rotulo: string; valor: number }>()
  for (const linha of posicoesAbertas(consolidado)) {
    const valor = Math.max(linha.valorAtual, 0)
    const atual = entradas.get(linha.categoria)
    if (atual) atual.valor += valor
    else entradas.set(linha.categoria, { rotulo: categoriaLabel(linha.categoria), valor })
  }
  return montarAlocacao(entradas)
}

/** Alocação por ativo (RF08) — apenas posições abertas com valor positivo. */
export function alocacaoPorAtivo(consolidado: readonly Consolidado[]): AlocacaoItem[] {
  const entradas = new Map<string, { rotulo: string; valor: number }>()
  for (const linha of posicoesAbertas(consolidado)) {
    const valor = Math.max(linha.valorAtual, 0)
    entradas.set(linha.ticker, { rotulo: linha.ticker, valor })
  }
  return montarAlocacao(entradas)
}

function agruparProventos(
  proventos: readonly Provento[],
  chaveDe: (provento: Provento) => string,
  rotuloDe: (provento: Provento, chave: string) => string,
  ordem: 'asc' | 'desc' = 'asc',
): AgregadoProvento[] {
  const mapa = new Map<string, AgregadoProvento>()
  for (const provento of proventos) {
    const chave = chaveDe(provento)
    if (chave.length === 0) continue
    const atual = mapa.get(chave)
    if (atual) atual.valorTotal += provento.valorTotal
    else mapa.set(chave, { chave, rotulo: rotuloDe(provento, chave), valorTotal: provento.valorTotal })
  }
  return [...mapa.values()]
    .map((item) => ({ ...item, valorTotal: round2(item.valorTotal) }))
    .sort((a, b) =>
      ordem === 'asc' ? a.chave.localeCompare(b.chave) : b.chave.localeCompare(a.chave),
    )
}

/** Total de proventos por ano (RF11), do mais recente para o mais antigo. */
export function agruparProventosPorAno(proventos: readonly Provento[]): AgregadoProvento[] {
  return agruparProventos(
    proventos,
    (provento) => provento.dataPagamento.slice(0, 4),
    (_provento, chave) => chave,
    'desc',
  )
}

/** Total de proventos por mês (`YYYY-MM`), do mais recente para o mais antigo. */
export function agruparProventosPorMes(proventos: readonly Provento[]): AgregadoProvento[] {
  return agruparProventos(
    proventos,
    (provento) => provento.dataPagamento.slice(0, 7),
    (_provento, chave) => formatarMesAnoBR(chave),
    'desc',
  )
}

/** Total de proventos por ticker (RF11). */
export function agruparProventosPorTicker(proventos: readonly Provento[]): AgregadoProvento[] {
  return agruparProventos(
    proventos,
    (provento) => provento.ticker.trim(),
    (_provento, chave) => chave,
  )
}

/** Total de proventos por tipo (Dividendo/JCP/Rendimento — RF11). */
export function agruparProventosPorTipo(proventos: readonly Provento[]): AgregadoProvento[] {
  return agruparProventos(
    proventos,
    (provento) => provento.tipo,
    (_provento, chave) => chave,
  )
}

/**
 * Filtra proventos por ano (`YYYY`) e/ou mês (`YYYY-MM`) com base na
 * `dataPagamento`. Filtros vazios são ignorados.
 */
export function filtrarProventos(
  proventos: readonly Provento[],
  filtro: { ano?: string; mes?: string },
): Provento[] {
  return proventos.filter((provento) => {
    if (provento.dataPagamento.length < 7) return false
    if (filtro.ano && !provento.dataPagamento.startsWith(filtro.ano)) return false
    if (filtro.mes && !provento.dataPagamento.startsWith(filtro.mes)) return false
    return true
  })
}

/** Anos com proventos, do mais recente para o mais antigo. */
export function anosComProventos(proventos: readonly Provento[]): string[] {
  const anos = new Set<string>()
  for (const provento of proventos) {
    const ano = provento.dataPagamento.slice(0, 4)
    if (ano.length === 4) anos.add(ano)
  }
  return [...anos].sort((a, b) => b.localeCompare(a))
}

/** Soma de proventos em **centavos**. */
export function totalProventos(proventos: readonly Provento[]): number {
  return round2(proventos.reduce((soma, provento) => soma + provento.valorTotal, 0))
}

/** Série de evolução patrimonial (RF09) ordenada por data crescente. */
export function serieEvolucao(historico: readonly Snapshot[]): EvolucaoPonto[] {
  return [...historico]
    .filter((snapshot) => snapshot.data.length > 0)
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((snapshot) => ({
      data: snapshot.data,
      rotulo: formatarDataBR(snapshot.data),
      patrimonioTotal: snapshot.patrimonioTotal,
      totalInvestido: snapshot.totalInvestido,
      lucroAcumulado: snapshot.lucroAcumulado,
    }))
}
