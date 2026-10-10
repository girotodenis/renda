/**
 * Tipos de domínio do app (espelham as colunas das abas — Seção 2 da especificação).
 *
 * Convenções (ver skills `dominio-negocio` e `convencoes-projeto`):
 * - Dinheiro sempre em **centavos inteiros** (`number`), convertido na borda da planilha.
 * - Datas internas em ISO `YYYY-MM-DD`; exibição `DD/MM/AAAA`.
 * - Categoria SEMPRE pelo enum canônico `CategoriaAtivo` (nunca string solta).
 */

/** Categoria canônica de ativo (lista única — Seção 2). */
export const CategoriaAtivo = {
  Acao: 'Acao',
  Fii: 'Fii',
  Bdr: 'Bdr',
  Etf: 'Etf',
  TesouroDireto: 'TesouroDireto',
  RendaFixa: 'RendaFixa',
} as const

export type CategoriaAtivo = (typeof CategoriaAtivo)[keyof typeof CategoriaAtivo]

/**
 * Tipo de lançamento registrado na aba `Operacoes`.
 *
 * Além das movimentações de compra/venda, a aba guarda os **eventos
 * corporativos** (RF20, Seção 5.6): `Split`, `Grupamento` e `Bonificacao`.
 * Eles não geram lucro/prejuízo — apenas ajustam quantidade e preço médio.
 */
export const OperacaoTipo = {
  Compra: 'Compra',
  Venda: 'Venda',
  Split: 'Split',
  Grupamento: 'Grupamento',
  Bonificacao: 'Bonificacao',
} as const

export type OperacaoTipo = (typeof OperacaoTipo)[keyof typeof OperacaoTipo]

/** Movimentações editáveis no formulário de operações (compra/venda). */
export const OPERACAO_MOVIMENTO_TIPOS = [OperacaoTipo.Compra, OperacaoTipo.Venda] as const

/** Tipos de evento corporativo (RF20, Seção 5.6). */
export const EVENTO_CORPORATIVO_TIPOS = [
  OperacaoTipo.Split,
  OperacaoTipo.Grupamento,
  OperacaoTipo.Bonificacao,
] as const

export type EventoCorporativoTipo = (typeof EVENTO_CORPORATIVO_TIPOS)[number]

/** Tipo de provento registrado na aba `Proventos`. */
export const ProventoTipo = {
  Dividendo: 'Dividendo',
  Jcp: 'JCP',
  Rendimento: 'Rendimento',
} as const

export type ProventoTipo = (typeof ProventoTipo)[keyof typeof ProventoTipo]

/** Indexador de Renda Fixa (aba `Operacoes`). */
export const IndexadorRendaFixa = {
  Cdi: 'CDI',
  Ipca: 'IPCA',
  Prefixado: 'Prefixado',
} as const

export type IndexadorRendaFixa = (typeof IndexadorRendaFixa)[keyof typeof IndexadorRendaFixa]

/**
 * Operação de compra/venda — aba `Operacoes`.
 *
 * Campos de Renda Fixa são opcionais (`null` quando a categoria não é Renda Fixa).
 */
export interface Operacao {
  /** UUID/timestamp — nunca reutilizado. */
  id: string
  /** ISO `YYYY-MM-DD`. */
  data: string
  tipo: OperacaoTipo
  categoria: CategoriaAtivo
  ticker: string
  /** Quantidade (pode ser fracionária em Tesouro Direto / Renda Fixa). */
  quantidade: number
  /** Preço unitário em **centavos**. */
  precoUnitario: number
  /** Taxas em **centavos**. */
  taxas: number
  /** `CDI`, `IPCA` ou `Prefixado` (Renda Fixa). */
  indexador: IndexadorRendaFixa | null
  /** `% do Indexador` (ex.: `110` para 110% do CDI). */
  percentualIndexador: number | null
  /** ISO `YYYY-MM-DD` (Renda Fixa). */
  vencimento: string | null
  /** Marcação a mercado editável (`Valor Bruto Atual`) em **centavos**. */
  valorBrutoAtual: number | null
}

/** Provento recebido (dividendo, JCP ou rendimento) — aba `Proventos`. */
export interface Provento {
  /** UUID/timestamp — nunca reutilizado. */
  id: string
  /** ISO `YYYY-MM-DD` (opcional). */
  dataCom: string | null
  /** ISO `YYYY-MM-DD`. */
  dataPagamento: string
  categoria: CategoriaAtivo
  ticker: string
  tipo: ProventoTipo
  /** Valor total recebido em **centavos**. */
  valorTotal: number
}

/**
 * Linha consolidada da carteira — aba `Consolidado` (Seção 5.1).
 *
 * As colunas calculadas são preenchidas por fórmulas do Sheets ou pelo app
 * (Etapa 4); valores monetários em **centavos**.
 */
export interface Consolidado {
  ticker: string
  categoria: CategoriaAtivo
  /** Quantidade atual (compras − vendas). */
  quantidadeAtual: number
  /** Preço médio em **centavos**. */
  precoMedio: number
  /** Preço atual (cotação) em **centavos**. */
  precoAtual: number
  /** Total investido em **centavos**. */
  totalInvestido: number
  /** Valor atual em **centavos**. */
  valorAtual: number
  /** Lucro/prejuízo em **centavos**. */
  lucroPrejuizo: number
  /** Lucro/prejuízo percentual (%). */
  lucroPrejuizoPercent: number
  /** Participação do ativo na carteira (%). */
  percentualCarteira: number
}

/** Configuração de meta e aporte de um ativo — aba `Metas_Rebalanceamento`. */
export interface MetaRebalanceamento {
  ticker: string
  categoria: CategoriaAtivo
  /** Nota de 0 a 10 (base do rebalanceamento por peso). */
  nota: number
  /** Meta percentual (%). */
  metaPercent: number
  /** Valor atual em **centavos**. */
  valorAtual: number
  /** Percentual atual (%). */
  percentualAtual: number
  /** Desvio entre o percentual atual e a meta (%). */
  desvioPercent: number
  /** Aporte sugerido em **centavos**. */
  aporteSugerido: number
  /** Quantidade sugerida (inteiro). */
  quantidadeSugerida: number
  /** Preço teto em **centavos** (opcional). */
  precoTeto: number | null
}

/**
 * Análise de valuation de um ticker — aba `Valuation` (alerta de oportunidade
 * de compra). Registra o preço teto, a margem de segurança e as anotações da
 * tese de investimento; o alerta dispara quando a cotação atual fica igual ou
 * abaixo do limite de compra (`teto − teto × margem ÷ 100`).
 */
export interface Valuation {
  ticker: string
  categoria: CategoriaAtivo
  /** Preço teto (valor justo) em **centavos** — `null` quando não informado. */
  precoTeto: number | null
  /** Margem de segurança em % (ex.: `20` para 20%) — `null` quando não informada. */
  margemSeguranca: number | null
  /** Anotações livres da tese de investimento. */
  anotacoes: string
}

/** Snapshot de patrimônio — aba `Historico` (RF18). */
export interface Snapshot {
  /** ISO `YYYY-MM-DD`. */
  data: string
  /** Patrimônio total em **centavos**. */
  patrimonioTotal: number
  /** Total investido em **centavos**. */
  totalInvestido: number
  /** Lucro acumulado em **centavos**. */
  lucroAcumulado: number
}
