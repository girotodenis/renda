import type { CategoriaAtivo, Consolidado } from '@/types/domain'

/**
 * Tipos do módulo **puro** de rebalanceamento (Seções 5.2–5.7).
 *
 * Convenções: dinheiro em **centavos inteiros**; percentuais em **0–100**.
 */

/** Carteira de entrada dos algoritmos: o `Consolidado` já calculado (Seção 5.1). */
export type Carteira = readonly Consolidado[]

/** Mapa `ticker → meta %` (efetivo, normalizado para 100%). */
export type MetasPorTicker = Readonly<Record<string, number>>

/** Mapa `ticker → preço teto em centavos` (Seção 5.5). */
export type PrecoTeto = Readonly<Record<string, number>>

/** Entrada do cálculo de metas (nota + meta de classe + override por ticker). */
export interface MetaInput {
  ticker: string
  categoria: CategoriaAtivo
  /** Nota de 0 a 10 (base do rateio quando não há meta individual). */
  nota?: number
  /** Meta % da classe (nível base — Seção 5.7). */
  metaClasse: number
  /** Meta % individual do ticker (override — Seção 5.7). */
  metaIndividual?: number
}

/** Item sugerido de compra/venda. */
export interface ItemAporte {
  ticker: string
  /** Quantidade sugerida (inteira, ou fracionária quando habilitado). */
  qtd: number
  /** Valor efetivamente alocado em **centavos**. */
  valorAlocado: number
}

/**
 * Resultado do aporte inteligente — lista de compras + o **resto** não alocado
 * (em centavos). A forma é um array com a propriedade adicional `resto`, para
 * manter a assinatura da skill `algoritmo-rebalanceamento`.
 */
export type AporteResult = ItemAporte[] & { resto: number }

/** Resultado do rebalanceamento completo (Seção 5.4): compras e vendas. */
export interface RebalanceamentoCompleto {
  compras: ItemAporte[]
  vendas: ItemAporte[]
}

/** Situação de um ativo em relação à meta (RF16). */
export type SituacaoDesvio = 'subalocado' | 'sobrealocado' | 'equilibrado'

/** Linha de desvio de um ativo (RF16 — alertas). */
export interface DesvioAtivo {
  ticker: string
  categoria: CategoriaAtivo
  /** Valor atual em **centavos**. */
  valorAtual: number
  /** % atual da carteira (0–100). */
  percentualAtual: number
  /** Meta efetiva (0–100). */
  metaPercent: number
  /** Valor alvo em **centavos**. */
  valorAlvo: number
  /** Desvio em **centavos** (`valorAtual − valorAlvo`). */
  desvioValor: number
  /** Desvio percentual (`percentualAtual − metaPercent`). */
  desvioPercent: number
  situacao: SituacaoDesvio
  /** Preço teto em **centavos** (Seção 5.5), quando definido. */
  precoTeto: number | null
  /** `true` quando a cotação atual supera o preço teto (ativo inelegível no aporte). */
  acimaDoTeto: boolean
}

/** Configuração de meta salva/editable por ticker (aba `Metas_Rebalanceamento`). */
export interface ItemMetaConfig {
  ticker: string
  categoria: CategoriaAtivo
  /** Nota de 0 a 10. */
  nota: number
  /** Meta % individual (override) — `null` quando o ativo segue a meta da classe. */
  metaIndividual: number | null
  /** Preço teto em **centavos** — `null` quando não definido. */
  precoTeto: number | null
}

/** Configuração completa de metas: nível classe + nível ticker (Seção 5.7). */
export interface ConfiguracaoMetas {
  /** Meta % por categoria (nível base). */
  metasClasse: Partial<Record<CategoriaAtivo, number>>
  itens: ItemMetaConfig[]
}

/** Opções do aporte inteligente (lotes e mercado fracionário — Seções 5.3/5.5). */
export interface AporteOpcoes {
  /** Tamanho do lote padrão (ex.: `100`). Default `1` (mercado fracionário livre). */
  lote?: number
  /** Permite quantidade fracionária (ex.: Tesouro Direto / ações fracionárias). */
  permitirFracionario?: boolean
}
