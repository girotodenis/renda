import { usaGoogFinance } from '@/lib/categoria'
import type { PosicaoConsolidada, PrecosAtuais } from '@/lib/consolidado'
import { fromCentavos } from '@/lib/money'
import type { CellValue } from '@/lib/sheetCells'
import { SHEET_HEADERS } from '@/lib/sheetsSchema'

/**
 * Fórmulas da aba `Consolidado` (Seção 5.1).
 *
 * A planilha é a única superfície que executa `GOOGLEFINANCE`; portanto as
 * colunas dependentes da cotação são gravadas como **fórmulas** (com
 * `USER_ENTERED`), enquanto as colunas de custo (quantidade e preço médio),
 * derivadas das operações, são **valores** calculados no app.
 *
 * O separador de argumentos (`;` ou `,`) depende do locale da planilha
 * (Brasil usa `;`) — ver skill `integracao-google-sheets`.
 */

/** Separador de argumentos aceito pelas fórmulas do Google Sheets. */
export type FormulaSeparator = ';' | ','

/**
 * Deduz o separador de fórmula a partir do locale da planilha: locales com
 * decimal por vírgula (ex.: `pt_BR`, `pt-PT`, `de`, `fr`) usam `;`; locales
 * com decimal por ponto (ex.: `en_US`) usam `,`.
 */
export function formulaSeparatorForLocale(locale: string | null | undefined): FormulaSeparator {
  const normalized = (locale ?? '').trim().toLowerCase()
  if (normalized.length === 0) return ';'
  return normalized.startsWith('en') ? ',' : ';'
}

/** Monta a fórmula de cotação: `=GOOGLEFINANCE("BVMF:"&$A2;"price")`. */
export function buildGoogFinanceFormula(
  tickerCellRef: string,
  separator: FormulaSeparator,
): string {
  return `=GOOGLEFINANCE("BVMF:"&${tickerCellRef}${separator}"price")`
}

/** Entrada para gerar as linhas da aba `Consolidado`. */
export interface ConsolidadoSheetInput {
  /** Posições calculadas (sem cotação), na ordem de escrita. */
  posicoes: readonly PosicaoConsolidada[]
  /** Cotações atuais em centavos (usadas nas classes sem `GOOGLEFINANCE`). */
  precosAtuais: PrecosAtuais
  separator: FormulaSeparator
}

/** Colunas da aba `Consolidado` (fonte única: cabeçalhos). */
const CONSOLIDADO_COLUMN_COUNT = SHEET_HEADERS.Consolidado.length

/**
 * Gera as linhas de dados da aba `Consolidado` (a partir da linha 2), na ordem
 * exata das colunas: `Ticker`, `Categoria`, `Quantidade Atual`, `Preço Médio`,
 * `Preço Atual`, `Total Investido`, `Valor Atual`, `Lucro/Prejuízo (R$)`,
 * `Lucro/Prejuízo (%)`, `% da Carteira`.
 *
 * Colunas C e D são valores calculados no app; E é `GOOGLEFINANCE` (Ação/FII/
 * BDR) ou valor manual; F–J são fórmulas que referenciam C/D/E e o total da
 * coluna G — preservando o comportamento reativo da planilha.
 */
export function buildConsolidadoRows(input: ConsolidadoSheetInput): CellValue[][] {
  const { posicoes, precosAtuais, separator } = input
  const lastRow = posicoes.length + 1

  return posicoes.map((posicao, index) => {
    const row = index + 2
    const precoAtual = precosAtuais.get(posicao.ticker) ?? posicao.precoMedio
    const precoAtualCell = usaGoogFinance(posicao.categoria)
      ? buildGoogFinanceFormula(`$A${row}`, separator)
      : fromCentavos(precoAtual)

    const totalInvestido = `=$C${row}*$D${row}`
    const valorAtual = `=$C${row}*$E${row}`
    const lucro = `=$G${row}-$F${row}`
    const lucroPercent = `=IF($F${row}=0${separator}0${separator}$H${row}/$F${row}*100)`
    const somaValorAtual = `SUM($G$2:$G$${lastRow})`
    const percentualCarteira = `=IF(${somaValorAtual}=0${separator}0${separator}$G${row}/${somaValorAtual}*100)`

    const cells: CellValue[] = [
      posicao.ticker,
      posicao.categoria,
      posicao.quantidadeAtual,
      fromCentavos(posicao.precoMedio),
      precoAtualCell,
      totalInvestido,
      valorAtual,
      lucro,
      lucroPercent,
      percentualCarteira,
    ]

    // Garante que nenhuma coluna seja adicionada/removida sem atualizar o schema.
    if (cells.length !== CONSOLIDADO_COLUMN_COUNT) {
      throw new Error('Número de colunas do Consolidado divergente do esquema.')
    }

    return cells
  })
}
