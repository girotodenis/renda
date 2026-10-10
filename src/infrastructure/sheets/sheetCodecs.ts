import { parseCategoriaAtivo } from '@/lib/categoria'
import {
  cellToCentavos,
  cellToIsoDate,
  cellToNumber,
  cellToOptionalCentavos,
  cellToOptionalNumber,
  cellToText,
  centavosToCell,
  optionalCentavosToCell,
} from '@/lib/sheetCells'
import type { CellValue } from '@/lib/sheetCells'
import type { SheetName } from '@/lib/sheetsSchema'
import type {
  Consolidado,
  IndexadorRendaFixa,
  MetaRebalanceamento,
  Operacao,
  OperacaoTipo,
  Provento,
  ProventoTipo,
  Snapshot,
} from '@/types/domain'
import { CategoriaAtivo, IndexadorRendaFixa as Indexador, OperacaoTipo as TipoOperacao, ProventoTipo as TipoProvento } from '@/types/domain'

/**
 * Codecs linha ↔ entidade por aba.
 *
 * A ordem das células segue `SHEET_HEADERS` (fonte única) e mantém o mapeamento
 * com as colunas da Seção 2 da especificação. Lógica pura (sem rede/UI).
 */

export interface SheetCodec<T> {
  readonly sheetName: SheetName
  toRow(entity: T): CellValue[]
  fromRow(row: readonly CellValue[]): T
}

function at(row: readonly CellValue[], index: number): CellValue {
  return row[index] ?? null
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase()
}

function parseOperacaoTipo(value: CellValue): OperacaoTipo {
  const normalized = normalize(cellToText(value))
  const match = (Object.values(TipoOperacao) as OperacaoTipo[]).find(
    (tipo) => normalize(tipo) === normalized,
  )
  return match ?? TipoOperacao.Compra
}

function parseProventoTipo(value: CellValue): ProventoTipo {
  const normalized = normalize(cellToText(value))
  if (normalized === normalize(TipoProvento.Jcp)) return TipoProvento.Jcp
  if (normalized === normalize(TipoProvento.Rendimento)) return TipoProvento.Rendimento
  return TipoProvento.Dividendo
}

function parseIndexador(value: CellValue): IndexadorRendaFixa | null {
  const normalized = normalize(cellToText(value))
  if (normalized.length === 0) return null
  const match = (Object.values(Indexador) as IndexadorRendaFixa[]).find(
    (indexador) => normalize(indexador) === normalized,
  )
  return match ?? null
}

export const operacoesCodec: SheetCodec<Operacao> = {
  sheetName: 'Operacoes',
  toRow: (operacao) => [
    operacao.id,
    operacao.data,
    operacao.tipo,
    operacao.categoria,
    operacao.ticker,
    operacao.quantidade,
    centavosToCell(operacao.precoUnitario),
    centavosToCell(operacao.taxas),
    operacao.indexador ?? '',
    operacao.percentualIndexador ?? '',
    operacao.vencimento ?? '',
    optionalCentavosToCell(operacao.valorBrutoAtual),
  ],
  fromRow: (row) => ({
    id: cellToText(at(row, 0)),
    data: cellToIsoDate(at(row, 1)) ?? '',
    tipo: parseOperacaoTipo(at(row, 2)),
    categoria: parseCategoriaAtivo(at(row, 3)) ?? CategoriaAtivo.Acao,
    ticker: cellToText(at(row, 4)),
    quantidade: cellToNumber(at(row, 5)),
    precoUnitario: cellToCentavos(at(row, 6)),
    taxas: cellToCentavos(at(row, 7)),
    indexador: parseIndexador(at(row, 8)),
    percentualIndexador: cellToOptionalNumber(at(row, 9)),
    vencimento: cellToIsoDate(at(row, 10)),
    valorBrutoAtual: cellToOptionalCentavos(at(row, 11)),
  }),
}

export const proventosCodec: SheetCodec<Provento> = {
  sheetName: 'Proventos',
  toRow: (provento) => [
    provento.id,
    provento.dataCom ?? '',
    provento.dataPagamento,
    provento.categoria,
    provento.ticker,
    provento.tipo,
    centavosToCell(provento.valorTotal),
  ],
  fromRow: (row) => ({
    id: cellToText(at(row, 0)),
    dataCom: cellToIsoDate(at(row, 1)),
    dataPagamento: cellToIsoDate(at(row, 2)) ?? '',
    categoria: parseCategoriaAtivo(at(row, 3)) ?? CategoriaAtivo.Acao,
    ticker: cellToText(at(row, 4)),
    tipo: parseProventoTipo(at(row, 5)),
    valorTotal: cellToCentavos(at(row, 6)),
  }),
}

export const consolidadoCodec: SheetCodec<Consolidado> = {
  sheetName: 'Consolidado',
  toRow: (linha) => [
    linha.ticker,
    linha.categoria,
    linha.quantidadeAtual,
    centavosToCell(linha.precoMedio),
    centavosToCell(linha.precoAtual),
    centavosToCell(linha.totalInvestido),
    centavosToCell(linha.valorAtual),
    centavosToCell(linha.lucroPrejuizo),
    linha.lucroPrejuizoPercent,
    linha.percentualCarteira,
  ],
  fromRow: (row) => ({
    ticker: cellToText(at(row, 0)),
    categoria: parseCategoriaAtivo(at(row, 1)) ?? CategoriaAtivo.Acao,
    quantidadeAtual: cellToNumber(at(row, 2)),
    precoMedio: cellToCentavos(at(row, 3)),
    precoAtual: cellToCentavos(at(row, 4)),
    totalInvestido: cellToCentavos(at(row, 5)),
    valorAtual: cellToCentavos(at(row, 6)),
    lucroPrejuizo: cellToCentavos(at(row, 7)),
    lucroPrejuizoPercent: cellToNumber(at(row, 8)),
    percentualCarteira: cellToNumber(at(row, 9)),
  }),
}

export const metasCodec: SheetCodec<MetaRebalanceamento> = {
  sheetName: 'Metas_Rebalanceamento',
  toRow: (meta) => [
    meta.ticker,
    meta.categoria,
    meta.nota,
    meta.metaPercent,
    centavosToCell(meta.valorAtual),
    meta.percentualAtual,
    meta.desvioPercent,
    centavosToCell(meta.aporteSugerido),
    meta.quantidadeSugerida,
    optionalCentavosToCell(meta.precoTeto),
  ],
  fromRow: (row) => ({
    ticker: cellToText(at(row, 0)),
    categoria: parseCategoriaAtivo(at(row, 1)) ?? CategoriaAtivo.Acao,
    nota: cellToNumber(at(row, 2)),
    metaPercent: cellToNumber(at(row, 3)),
    valorAtual: cellToCentavos(at(row, 4)),
    percentualAtual: cellToNumber(at(row, 5)),
    desvioPercent: cellToNumber(at(row, 6)),
    aporteSugerido: cellToCentavos(at(row, 7)),
    quantidadeSugerida: cellToNumber(at(row, 8)),
    precoTeto: cellToOptionalCentavos(at(row, 9)),
  }),
}

export const historicoCodec: SheetCodec<Snapshot> = {
  sheetName: 'Historico',
  toRow: (snapshot) => [
    snapshot.data,
    centavosToCell(snapshot.patrimonioTotal),
    centavosToCell(snapshot.totalInvestido),
    centavosToCell(snapshot.lucroAcumulado),
  ],
  fromRow: (row) => ({
    data: cellToIsoDate(at(row, 0)) ?? '',
    patrimonioTotal: cellToCentavos(at(row, 1)),
    totalInvestido: cellToCentavos(at(row, 2)),
    lucroAcumulado: cellToCentavos(at(row, 3)),
  }),
}
