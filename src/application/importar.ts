import type { RepositoryContext } from '@/domain/repositories/ports'
import type { SheetName } from '@/domain/sheetsSchema'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import { syncConsolidado } from '@/application/consolidado'
import { invalidateSpreadsheetCache } from '@/infrastructure/cache'
import type { AbaOdsLida } from '@/infrastructure/ods/odsReader'
import { lerAbasOds } from '@/infrastructure/ods/odsReader'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { clearValues, columnLetter, ensureRequiredSheets, updateValues } from '@/infrastructure/sheets/gatewayRouter'

/**
 * Importação de carteira a partir de um arquivo `.ods` (caminho inverso da
 * exportação).
 *
 * Funciona na origem ativa: no modo local grava no banco do navegador; no modo
 * Google grava na planilha ativa. As abas são **substituídas** (não mescladas),
 * para que exportar → editar → importar seja um ciclo previsível.
 *
 * A aba `Consolidado` é derivada: se vier no arquivo, é ignorada e recalculada a
 * partir das operações importadas.
 */

/** Abas cujo conteúdo é importado (`Consolidado` é recalculada). */
export const ABAS_IMPORTAVEIS: readonly SheetName[] = [
  'Operacoes',
  'Proventos',
  'Metas_Rebalanceamento',
  'Historico',
  'Valuation',
  'Ativos',
  'Configuracoes',
]

/** Aba reconhecida no arquivo, com a quantidade de linhas de dados. */
export interface AbaImportada {
  nome: SheetName
  linhas: number
}

/** Resultado da análise do arquivo (antes de gravar qualquer coisa). */
export interface AnaliseImportacao {
  /** Abas reconhecidas que serão substituídas. */
  abas: AbaImportada[]
  /** Abas do arquivo que o app não conhece (ignoradas). */
  desconhecidas: string[]
  /** O arquivo trazia a aba derivada `Consolidado`. */
  temConsolidado: boolean
  /** Linhas prontas para gravação (sem o cabeçalho), por aba. */
  dados: Map<SheetName, CellValue[][]>
}

/** Resultado da importação efetivada. */
export interface ResultadoImportacao {
  abas: AbaImportada[]
  desconhecidas: string[]
  /** Quantidade de posições recalculadas na aba `Consolidado`. */
  linhasConsolidadas: number
}

/** Normaliza um nome de aba para comparação tolerante (acentos/caixa/separador). */
function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase()
}

const ABA_POR_NOME_NORMALIZADO = new Map<string, SheetName>(
  SHEET_NAMES.map((nome) => [normalizarNome(nome), nome]),
)

function normalizarCelula(valor: CellValue | undefined): string {
  return valor === null || valor === undefined ? '' : normalizarNome(String(valor))
}

/** `true` quando a linha é o cabeçalho do schema (tolerante a acentos/caixa). */
function ehCabecalho(nome: SheetName, linha: readonly CellValue[]): boolean {
  const cabecalho = SHEET_HEADERS[nome]
  if (linha.length < 2) return false

  const comparados = Math.min(linha.length, cabecalho.length)
  for (let index = 0; index < comparados; index += 1) {
    if (normalizarCelula(linha[index]) !== normalizarNome(cabecalho[index])) return false
  }
  return true
}

function linhaVazia(linha: readonly CellValue[]): boolean {
  return linha.every(
    (cell) =>
      cell === null || cell === undefined || (typeof cell === 'string' && cell.trim().length === 0),
  )
}

/** Remove o cabeçalho (quando presente) e as linhas vazias do fim. */
function linhasDeDados(nome: SheetName, valores: AbaOdsLida['valores']): CellValue[][] {
  const largura = SHEET_HEADERS[nome].length
  const linhas = valores.map((linha) => linha.slice(0, largura).map((cell) => cell ?? null))

  if (linhas.length > 0 && ehCabecalho(nome, linhas[0])) linhas.shift()

  let fim = linhas.length
  while (fim > 0 && linhaVazia(linhas[fim - 1])) fim -= 1
  return linhas.slice(0, fim)
}

/** Analisa as abas lidas do `.ods` sem gravar nada (para confirmação na UI). */
export function analisarOds(abas: readonly AbaOdsLida[]): AnaliseImportacao {
  const dados = new Map<SheetName, CellValue[][]>()
  const resumo: AbaImportada[] = []
  const desconhecidas: string[] = []
  let temConsolidado = false

  for (const aba of abas) {
    const nome = ABA_POR_NOME_NORMALIZADO.get(normalizarNome(aba.nome))
    if (!nome) {
      desconhecidas.push(aba.nome)
      continue
    }
    if (nome === 'Consolidado') {
      temConsolidado = true
      continue
    }

    const linhas = linhasDeDados(nome, aba.valores)
    dados.set(nome, linhas)
    resumo.push({ nome, linhas: linhas.length })
  }

  return { abas: resumo, desconhecidas, temConsolidado, dados }
}

/**
 * Grava as abas analisadas na origem ativa e recalcula o `Consolidado`.
 *
 * A região de dados de cada aba é limpa antes da escrita (substituição, não
 * mesclagem) e nunca toca a linha 1 de cabeçalho.
 */
export async function aplicarImportacao(
  context: RepositoryContext,
  analise: AnaliseImportacao,
): Promise<ResultadoImportacao> {
  // Garante que as abas existam com a linha 1 de cabeçalho antes de escrever:
  // sem isso, a primeira linha de dados entraria na linha 1 e seria lida como
  // cabeçalho pelos codecs.
  await ensureRequiredSheets(context.accessToken, context.spreadsheetId)

  for (const [nome, linhas] of analise.dados) {
    const range = `'${nome}'!A2:${columnLetter(SHEET_HEADERS[nome].length)}`
    await clearValues(context.accessToken, context.spreadsheetId, range)
    if (linhas.length > 0) {
      await updateValues(
        context.accessToken,
        context.spreadsheetId,
        `${range}${linhas.length + 1}`,
        linhas,
      )
    }
  }

  // Nada do que estava em cache vale mais, inclusive o `Consolidado` antigo.
  invalidateSpreadsheetCache(context.spreadsheetId)

  const consolidado = await syncConsolidado(context, { forceRefreshOperacoes: true })

  return {
    abas: analise.abas,
    desconhecidas: analise.desconhecidas,
    linhasConsolidadas: consolidado.length,
  }
}

/** Lê, analisa e efetiva a importação de um arquivo `.ods`. */
export async function importarOds(
  context: RepositoryContext,
  bytes: Uint8Array,
): Promise<ResultadoImportacao> {
  const abas = await lerAbasOds(bytes)
  return aplicarImportacao(context, analisarOds(abas))
}
