import { round2 } from '@/domain/money'
import type { ConfiguracaoMetas, ItemMetaConfig, MetasPorTicker } from '@/domain/rebalanceamento'
import { CLASSE_MARKER, isLinhaDeClasse } from '@/domain/rebalanceamento'
import { carregarDashboard } from '@/application/dashboard'
import type { CarregarDashboardOptions } from '@/application/dashboard'
import { metasRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import type { Consolidado, MetaRebalanceamento } from '@/domain/entities'
import { CategoriaAtivo } from '@/domain/entities'

/**
 * Acesso à configuração de rebalanceamento (aba `Metas_Rebalanceamento`).
 *
 * A leitura é **cache-first** (RNF02), reaproveitando o carregamento do
 * dashboard (que já traz o `Consolidado` e, quando frio, faz um único
 * `batchGet`). A escrita reescreve a aba via repositório (linhas de classe +
 * linhas por ticker).
 *
 * Convenção de persistência (Seção 2 — colunas fixas):
 * - Linhas de **classe**: `Ticker = '#Classe'` e a meta da categoria em `Meta %`.
 * - Linhas de **ticker**: `Nota (0-10)` e `Preço Teto`; `Meta %` guarda o
 *   **override individual** (`0`/vazio quando o ativo segue a meta da classe).
 *   As metas efetivas (normalizadas) são recalculadas no app por
 *   `normalizarMetas` — não são a fonte de verdade da configuração.
 */

const CATEGORIAS_ORDEM: readonly CategoriaAtivo[] = [
  CategoriaAtivo.Acao,
  CategoriaAtivo.Bdr,
  CategoriaAtivo.Etf,
  CategoriaAtivo.Fii,
  CategoriaAtivo.TesouroDireto,
  CategoriaAtivo.RendaFixa,
]

export interface RebalanceamentoData {
  /** Posições consolidadas (Seção 5.1). */
  carteira: Consolidado[]
  /** Configuração salva de metas (classe + ticker). */
  config: ConfiguracaoMetas
  /** ISO do momento em que os dados foram montados (cache ou API). */
  carregadoEm: string
}

/** Converte as linhas da aba `Metas_Rebalanceamento` na configuração de metas. */
export function lerConfigRebalanceamento(rows: readonly MetaRebalanceamento[]): ConfiguracaoMetas {
  const metasClasse: Partial<Record<CategoriaAtivo, number>> = {}
  const itens: ItemMetaConfig[] = []
  const vistos = new Set<string>()

  for (const row of rows) {
    if (isLinhaDeClasse(row.ticker)) {
      metasClasse[row.categoria] = round2(row.metaPercent)
      continue
    }
    const ticker = row.ticker.trim()
    if (ticker.length === 0 || vistos.has(ticker)) continue
    vistos.add(ticker)
    itens.push({
      ticker,
      categoria: row.categoria,
      nota: row.nota,
      metaIndividual: row.metaPercent > 0 ? row.metaPercent : null,
      precoTeto: row.precoTeto,
    })
  }

  return { metasClasse, itens }
}

/** Monta as linhas da aba `Metas_Rebalanceamento` a partir da configuração. */
export function construirLinhasMetas(
  config: ConfiguracaoMetas,
  carteira: readonly Consolidado[],
  metasEfetivas: MetasPorTicker,
): MetaRebalanceamento[] {
  const linhas: MetaRebalanceamento[] = []

  for (const categoria of CATEGORIAS_ORDEM) {
    const metaClasse = config.metasClasse[categoria]
    if (metaClasse === undefined) continue
    linhas.push({
      ticker: CLASSE_MARKER,
      categoria,
      nota: 0,
      metaPercent: round2(metaClasse),
      valorAtual: 0,
      percentualAtual: 0,
      desvioPercent: 0,
      aporteSugerido: 0,
      quantidadeSugerida: 0,
      precoTeto: null,
    })
  }

  const porTicker = new Map(carteira.map((ativo) => [ativo.ticker.trim(), ativo]))
  for (const item of config.itens) {
    const ticker = item.ticker.trim()
    if (ticker.length === 0 || isLinhaDeClasse(ticker)) continue

    const ativo = porTicker.get(ticker)
    const percentualAtual = ativo?.percentualCarteira ?? 0
    const metaEfetiva = metasEfetivas[ticker] ?? 0

    linhas.push({
      ticker,
      categoria: item.categoria,
      nota: item.nota,
      metaPercent: item.metaIndividual !== null ? round2(item.metaIndividual) : 0,
      valorAtual: ativo?.valorAtual ?? 0,
      percentualAtual: round2(percentualAtual),
      desvioPercent: round2(percentualAtual - metaEfetiva),
      aporteSugerido: 0,
      quantidadeSugerida: 0,
      precoTeto: item.precoTeto,
    })
  }

  return linhas
}

/**
 * Carrega a carteira consolidada e a configuração de metas (cache-first).
 *
 * Reaproveita `carregarDashboard` (um único `batchGet` quando frio) e lê as
 * metas do cache; se o cache de metas estiver ausente, busca apenas essa aba.
 */
export async function carregarRebalanceamento(
  context: RepositoryContext,
  options: CarregarDashboardOptions = {},
): Promise<RebalanceamentoData> {
  const dashboard = await carregarDashboard(context, options)
  const cachedMetas = metasRepo.readCache(context.spreadsheetId)
  const metasRows = cachedMetas ?? (await metasRepo.refresh(context))
  return {
    carteira: dashboard.consolidado,
    config: lerConfigRebalanceamento(metasRows),
    carregadoEm: dashboard.carregadoEm,
  }
}

/** Persiste a configuração de metas na aba `Metas_Rebalanceamento`. */
export async function salvarConfigRebalanceamento(
  context: RepositoryContext,
  config: ConfiguracaoMetas,
  carteira: readonly Consolidado[],
  metasEfetivas: MetasPorTicker,
): Promise<void> {
  await metasRepo.replaceAll(context, construirLinhasMetas(config, carteira, metasEfetivas))
}
