/**
 * Esquema canônico das abas da planilha (Seção 2 da especificação).
 *
 * Fonte única de verdade para os nomes das abas e o cabeçalho de cada coluna.
 * Qualquer leitura/escrita nas abas deve usar estas constantes.
 */

export const SHEET_NAMES = [
  'Operacoes',
  'Proventos',
  'Consolidado',
  'Metas_Rebalanceamento',
  'Historico',
  'Valuation',
] as const

export type SheetName = (typeof SHEET_NAMES)[number]

/**
 * Cabeçalhos das colunas por aba.
 *
 * Observações:
 * - `Operacoes`: as 4 últimas colunas são específicas de Renda Fixa (opcionais).
 * - `Consolidado`: `Lucro/Prejuízo` é dividido em duas colunas (R$ e %).
 */
export const SHEET_HEADERS: Record<SheetName, readonly string[]> = {
  Operacoes: [
    'ID',
    'Data',
    'Tipo',
    'Categoria',
    'Ticker',
    'Quantidade',
    'Preço Unitário',
    'Taxas',
    'Indexador',
    '% do Indexador',
    'Vencimento',
    'Valor Bruto Atual',
  ],
  Proventos: ['ID', 'Data Com', 'Data Pagamento', 'Categoria', 'Ticker', 'Tipo', 'Valor Total'],
  Consolidado: [
    'Ticker',
    'Categoria',
    'Quantidade Atual',
    'Preço Médio',
    'Preço Atual',
    'Total Investido',
    'Valor Atual',
    'Lucro/Prejuízo (R$)',
    'Lucro/Prejuízo (%)',
    '% da Carteira',
  ],
  Metas_Rebalanceamento: [
    'Ticker',
    'Categoria',
    'Nota (0-10)',
    'Meta %',
    'Valor Atual',
    '% Atual',
    'Desvio %',
    'Aporte Sugerido (R$)',
    'Qtd Sugerida',
    'Preço Teto (opcional)',
  ],
  Historico: ['Data', 'Patrimônio Total', 'Total Investido', 'Lucro Acumulado'],
  Valuation: [
    'Ticker',
    'Categoria',
    'Preço Teto',
    'Margem de Segurança (%)',
    'Anotações da Análise',
  ],
}
