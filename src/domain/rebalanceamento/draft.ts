import { formatMoneyInput, parseBRL, parseDecimalBR, toCentavos } from '@/lib/money'
import { CategoriaAtivo } from '@/types/domain'
import type { ConfiguracaoMetas, ItemMetaConfig } from './types'

/**
 * Conversão entre a configuração de metas (números) e o rascunho editável do
 * formulário (strings pt-BR) — funções **puras** para manter os inputs sem
 * "round-trip" (o texto digitado é preservado até o save).
 */

/** Categorias na ordem canônica de exibição. */
export const CATEGORIAS_META: readonly CategoriaAtivo[] = [
  CategoriaAtivo.Acao,
  CategoriaAtivo.Bdr,
  CategoriaAtivo.Etf,
  CategoriaAtivo.Fii,
  CategoriaAtivo.TesouroDireto,
  CategoriaAtivo.RendaFixa,
]

/** Item editável de meta por ticker (valores como texto pt-BR). */
export interface ItemMetaDraft {
  ticker: string
  categoria: CategoriaAtivo
  /** Nota 0–10. */
  nota: string
  /** Meta % individual (override) — vazio quando segue a classe. */
  metaIndividual: string
  /** Preço teto em reais (pt-BR) — vazio quando não definido. */
  precoTeto: string
}

/** Rascunho editável da configuração de metas. */
export interface MetasDraft {
  /** Meta % por categoria (texto pt-BR; vazio quando não definida). */
  metasClasse: Partial<Record<CategoriaAtivo, string>>
  itens: ItemMetaDraft[]
}

function formatarDecimal(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor))
}

/** Monta o rascunho editável a partir da configuração numérica. */
export function draftDeConfig(config: ConfiguracaoMetas): MetasDraft {
  const metasClasse: Partial<Record<CategoriaAtivo, string>> = {}
  for (const categoria of CATEGORIAS_META) {
    const valor = config.metasClasse[categoria]
    metasClasse[categoria] = valor !== undefined ? formatarDecimal(valor) : ''
  }

  const itens = config.itens.map<ItemMetaDraft>((item) => ({
    ticker: item.ticker,
    categoria: item.categoria,
    nota: item.nota > 0 ? formatarDecimal(item.nota) : '',
    metaIndividual: item.metaIndividual !== null ? formatarDecimal(item.metaIndividual) : '',
    precoTeto: item.precoTeto !== null ? formatMoneyInput(item.precoTeto) : '',
  }))

  return { metasClasse, itens }
}

/** Converte o rascunho editável na configuração numérica (pesos/centavos). */
export function configDeDraft(draft: MetasDraft): ConfiguracaoMetas {
  const metasClasse: Partial<Record<CategoriaAtivo, number>> = {}
  for (const categoria of CATEGORIAS_META) {
    const valor = parseDecimalBR(draft.metasClasse[categoria] ?? '')
    if (valor !== null) metasClasse[categoria] = limitar(valor, 0, 100)
  }

  const itens: ItemMetaConfig[] = draft.itens.map((item) => {
    const metaIndividual = parseDecimalBR(item.metaIndividual)
    const tetoReais = parseBRL(item.precoTeto)
    return {
      ticker: item.ticker,
      categoria: item.categoria,
      nota: limitar(parseDecimalBR(item.nota) ?? 0, 0, 10),
      metaIndividual: metaIndividual !== null ? limitar(metaIndividual, 0, 100) : null,
      precoTeto: tetoReais !== null ? Math.max(0, toCentavos(tetoReais)) : null,
    }
  })

  return { metasClasse, itens }
}

/** Soma das metas de classe informadas (para o indicador de 100%). */
export function somaMetasClasse(config: ConfiguracaoMetas): number {
  return Object.values(config.metasClasse).reduce((acc, valor) => acc + (valor ?? 0), 0)
}
