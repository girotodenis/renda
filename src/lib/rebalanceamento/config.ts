import type { Carteira, ConfiguracaoMetas, ItemMetaConfig, MetaInput, PrecoTeto } from './types'

/**
 * Helpers para montar as entradas dos algoritmos a partir da configuração de
 * metas e da carteira consolidada — módulo **puro**.
 */

/** Indexa os itens de configuração por ticker (dedupe — o último vence). */
function itensPorTicker(config: ConfiguracaoMetas): Map<string, ConfiguracaoMetas['itens'][number]> {
  const mapa = new Map<string, ConfiguracaoMetas['itens'][number]>()
  for (const item of config.itens) {
    const ticker = item.ticker.trim()
    if (ticker.length === 0) continue
    mapa.set(ticker, item)
  }
  return mapa
}

/**
 * Monta os `MetaInput` a partir dos ativos da carteira e da configuração.
 *
 * O universo são os ativos **com posição na carteira** (têm categoria e, para
 * o aporte, preço). A categoria vem sempre do consolidado (fonte de verdade do
 * ativo); notas, meta individual e preço teto vêm da configuração.
 */
export function montarMetaInputs(carteira: Carteira, config: ConfiguracaoMetas): MetaInput[] {
  const configurados = itensPorTicker(config)
  const vistos = new Set<string>()
  const inputs: MetaInput[] = []

  for (const ativo of carteira) {
    const ticker = ativo.ticker.trim()
    if (ticker.length === 0 || vistos.has(ticker)) continue
    vistos.add(ticker)

    const item = configurados.get(ticker)
    inputs.push({
      ticker,
      categoria: ativo.categoria,
      nota: item?.nota ?? 0,
      metaClasse: Math.max(0, config.metasClasse[ativo.categoria] ?? 0),
      metaIndividual: item?.metaIndividual ?? undefined,
    })
  }

  return inputs
}

/** Extrai o mapa `ticker → preço teto (centavos)` da configuração (Seção 5.5). */
export function precoTetoDeConfig(config: ConfiguracaoMetas): PrecoTeto {
  const mapa: Record<string, number> = {}
  for (const item of config.itens) {
    const ticker = item.ticker.trim()
    if (ticker.length === 0) continue
    if (item.precoTeto !== null && item.precoTeto > 0) mapa[ticker] = item.precoTeto
  }
  return mapa
}

/** Tickers presentes na configuração que ainda não estão na carteira. */
export function tickersSomenteNaConfig(
  carteira: Carteira,
  config: ConfiguracaoMetas,
): string[] {
  const naCarteira = new Set(carteira.map((ativo) => ativo.ticker.trim()))
  return config.itens
    .map((item) => item.ticker.trim())
    .filter((ticker) => ticker.length > 0 && !naCarteira.has(ticker))
}

/**
 * Completa a configuração com uma entrada padrão para cada ativo da carteira
 * que ainda não tenha sido configurado (nota 0, sem meta individual/teto).
 * Preserva a ordem da carteira e não duplica tickers.
 */
export function completarConfigComCarteira(
  config: ConfiguracaoMetas,
  carteira: Carteira,
): ConfiguracaoMetas {
  const existentes = new Set(config.itens.map((item) => item.ticker.trim()))
  const vistos = new Set<string>()
  const novos: ItemMetaConfig[] = []

  for (const ativo of carteira) {
    const ticker = ativo.ticker.trim()
    if (ticker.length === 0 || existentes.has(ticker) || vistos.has(ticker)) continue
    vistos.add(ticker)
    novos.push({
      ticker,
      categoria: ativo.categoria,
      nota: 0,
      metaIndividual: null,
      precoTeto: null,
    })
  }

  if (novos.length === 0) return config
  return { metasClasse: config.metasClasse, itens: [...config.itens, ...novos] }
}
