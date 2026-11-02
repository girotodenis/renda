import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import { base64ParaBytes, bytesParaBase64 } from '@/domain/criptografia'
import { obterChave } from '@/infrastructure/cripto/chaveSessao'
import { ChaveIncorretaError, ChaveNecessariaError } from '@/infrastructure/cripto/envelope'
import { ID_COFRE_LOCAL, temCofreLocal } from '@/infrastructure/cripto/localCofre'
import { cifrarBytes, decifrarBytes } from '@/infrastructure/cripto/webCrypto'
import type { EnderecoA1 } from '@/infrastructure/sheets/a1'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { kvDelete, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'

/**
 * "Planilha" local do modo sem Google (RF02).
 *
 * Guarda a **matriz bruta de células** (`CellValue[][]`, com a linha 1 de
 * cabeçalho) de cada aba no IndexedDB, no mesmo *key-value store* usado pelo
 * cache de abas — mas em um namespace próprio (`local-sheet::<aba>`), que não
 * colide com as chaves do cache (`<spreadsheetId>.<aba>`).
 *
 * Guardar valores brutos (e não entidades já decodificadas) é o que permite:
 * - reusar os mesmos repositórios/codecs do modo Google, sem duplicar lógica;
 * - exportar o arquivo `.ods` exatamente com o que o usuário vê.
 *
 * **Cifra por aba (Fase 6).** Quando o cofre local existe, o valor persistido é
 * um envelope `{ v, iv, dados }` com AES-256-GCM e AAD = bytes da própria chave
 * do registro (`local-sheet::<aba>`): copiar o envelope de uma aba para outra
 * invalida a tag. Sem cofre, o valor continua sendo a matriz pura (banco antigo
 * ou banco simplesmente em claro).
 */

const KEY_PREFIX = 'local-sheet::'
const STORE = 'sheets'

/** Versão do envelope de uma aba cifrada (permite evoluir o formato). */
const VERSAO_ENVELOPE = 1

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Cofre ativo e aba em claro: a cifra foi ativada sem regravar as abas. Nunca
 * devolver esses dados em claro — o app trata como banco inconsistente.
 */
const MSG_ABAS_EM_CLARO =
  'As abas locais estão em claro, mas o cofre está ativo. Desbloqueie o banco e ative a criptografia novamente.'

function keyFor(sheetName: string): string {
  return `${KEY_PREFIX}${sheetName}`
}

/** Matriz de células de uma aba (linha 1 = cabeçalho). */
export type SheetMatrix = CellValue[][]

/** Envelope persistido de uma aba cifrada. */
interface EnvelopeAba {
  v: number
  /** IV do AES-GCM em Base64 (novo a cada gravação). */
  iv: string
  /** Ciphertext + tag em Base64. */
  dados: string
}

function ehEnvelope(valor: unknown): valor is EnvelopeAba {
  if (typeof valor !== 'object' || valor === null) return false
  const registro = valor as Record<string, unknown>
  return (
    registro.v === VERSAO_ENVELOPE &&
    typeof registro.iv === 'string' &&
    typeof registro.dados === 'string'
  )
}

/** AAD da aba: os mesmos bytes da chave do registro, para amarrar envelope e aba. */
function aadDaAba(sheetName: string): Uint8Array {
  return encoder.encode(keyFor(sheetName))
}

/** Chave do cofre local; sem ela nenhuma aba cifrada pode ser lida ou gravada. */
function chaveDaSessao(): CryptoKey {
  const sessao = obterChave(ID_COFRE_LOCAL)
  if (!sessao) throw new ChaveNecessariaError()
  return sessao.chave
}

function isEmptyCell(cell: CellValue | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim().length === 0)
}

function isEmptyRow(row: readonly CellValue[] | undefined): boolean {
  return !row || row.every((cell) => isEmptyCell(cell))
}

/** Remove linhas vazias no fim (mantém a matriz canônica e o `.ods` limpo). */
function trimTrailingEmptyRows(rows: SheetMatrix): SheetMatrix {
  let end = rows.length
  while (end > 0 && isEmptyRow(rows[end - 1])) end -= 1
  return rows.slice(0, end)
}

function copyMatrix(rows: SheetMatrix): SheetMatrix {
  return rows.map((row) => row.slice())
}

/** Lê a matriz completa de uma aba (`[]` quando a aba ainda não tem dados). */
export async function readLocalSheet(sheetName: string): Promise<SheetMatrix> {
  const bruto = kvGet<unknown>(STORE, keyFor(sheetName))

  if (!temCofreLocal()) return Array.isArray(bruto) ? (bruto as SheetMatrix) : []
  // Aba ainda não criada: não há o que decifrar.
  if (bruto === undefined || bruto === null) return []
  if (!ehEnvelope(bruto)) throw new ChaveNecessariaError(MSG_ABAS_EM_CLARO)

  const chave = chaveDaSessao()
  try {
    const claro = await decifrarBytes(
      chave,
      base64ParaBytes(bruto.iv),
      base64ParaBytes(bruto.dados),
      aadDaAba(sheetName),
    )
    const matriz: unknown = JSON.parse(decoder.decode(claro))
    return Array.isArray(matriz) ? (matriz as SheetMatrix) : []
  } catch {
    // Tag inválida, envelope adulterado ou JSON corrompido: uma única mensagem.
    throw new ChaveIncorretaError()
  }
}

/** Grava a matriz completa de uma aba (cifrada quando o cofre local existe). */
export async function writeLocalSheet(sheetName: string, values: SheetMatrix): Promise<void> {
  const matriz = trimTrailingEmptyRows(copyMatrix(values))

  if (!temCofreLocal()) {
    kvSet(STORE, keyFor(sheetName), matriz)
    return
  }

  // Sem a chave nunca se grava em claro: o cofre ativo exige a sessão desbloqueada.
  const { iv, ciphertext } = await cifrarBytes(
    chaveDaSessao(),
    encoder.encode(JSON.stringify(matriz)),
    aadDaAba(sheetName),
  )
  kvSet(STORE, keyFor(sheetName), {
    v: VERSAO_ENVELOPE,
    iv: bytesParaBase64(iv),
    dados: bytesParaBase64(ciphertext),
  } satisfies EnvelopeAba)
}

/** Lista as abas com dados no banco local. */
export function listLocalSheetNames(): string[] {
  return kvKeys(STORE)
    .filter((key) => key.startsWith(KEY_PREFIX))
    .map((key) => key.slice(KEY_PREFIX.length))
}

/** Remove todas as abas locais (usado no logout/limpeza explícita). */
export function clearLocalSheets(): string[] {
  const keys = kvKeys(STORE).filter((key) => key.startsWith(KEY_PREFIX))
  for (const key of keys) kvDelete(STORE, key)
  return keys.map((key) => key.slice(KEY_PREFIX.length))
}

/**
 * Cria as abas ausentes com a linha de cabeçalho do schema e completa os
 * cabeçalhos que faltam em abas já existentes (migração de colunas novas).
 * Devolve quantas abas foram criadas ou atualizadas.
 */
export async function ensureLocalSheetsWithHeaders(): Promise<number> {
  let atualizadas = 0
  for (const name of SHEET_NAMES) {
    const headers = SHEET_HEADERS[name]
    const rows = await readLocalSheet(name)

    if (rows.length === 0) {
      await writeLocalSheet(name, [[...headers]])
      atualizadas += 1
      continue
    }

    const atual = rows[0] ?? []
    let ultimoPreenchido = -1
    for (let column = 0; column < atual.length; column += 1) {
      if (!isEmptyCell(atual[column])) ultimoPreenchido = column
    }
    if (ultimoPreenchido + 1 >= headers.length) continue

    const next = copyMatrix(rows)
    const cabecalho = next[0] ?? []
    for (let column = ultimoPreenchido + 1; column < headers.length; column += 1) {
      cabecalho[column] = headers[column]
    }
    next[0] = cabecalho
    await writeLocalSheet(name, next)
    atualizadas += 1
  }
  return atualizadas
}

/** Recorta o intervalo pedido da matriz (linhas e colunas, sem padding). */
export async function readSheetRange(sheetName: string, address: EnderecoA1): Promise<SheetMatrix> {
  const rows = await readLocalSheet(sheetName)
  const end = address.endRow === null ? rows.length : address.endRow + 1
  const selected = rows
    .slice(address.startRow, end)
    .map((row) => row.slice(address.startColumn, address.endColumn + 1))
  return trimTrailingEmptyRows(selected)
}

/** Escreve `values` a partir da célula inicial do intervalo (crescendo a matriz). */
export async function writeSheetRange(
  sheetName: string,
  address: EnderecoA1,
  values: readonly (readonly CellValue[])[],
): Promise<void> {
  const rows = copyMatrix(await readLocalSheet(sheetName))

  values.forEach((line, index) => {
    const rowIndex = address.startRow + index
    while (rows.length <= rowIndex) rows.push([])

    const row = rows[rowIndex]
    const width = address.startColumn + line.length
    while (row.length < width) row.push(null)

    line.forEach((cell, offset) => {
      row[address.startColumn + offset] = cell ?? null
    })
  })

  await writeLocalSheet(sheetName, rows)
}

/**
 * Acrescenta linhas ao final da tabela existente (`values.append`).
 *
 * Mesma semântica do Google: encontra a última linha com conteúdo a partir da
 * linha inicial do intervalo e escreve logo depois dela.
 */
export async function appendValuesToSheet(
  sheetName: string,
  address: EnderecoA1,
  values: readonly (readonly CellValue[])[],
): Promise<void> {
  const rows = await readLocalSheet(sheetName)
  let lastContentRow = address.startRow - 1
  for (let index = address.startRow; index < rows.length; index += 1) {
    if (!isEmptyRow(rows[index])) lastContentRow = index
  }
  await writeSheetRange(sheetName, { ...address, startRow: lastContentRow + 1 }, values)
}

/** Limpa (zera) as células do intervalo, preservando o resto da aba. */
export async function clearSheetRange(sheetName: string, address: EnderecoA1): Promise<void> {
  const rows = copyMatrix(await readLocalSheet(sheetName))
  const lastRow = address.endRow === null ? rows.length - 1 : Math.min(address.endRow, rows.length - 1)

  for (let rowIndex = address.startRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row) continue
    for (let column = address.startColumn; column <= address.endColumn; column += 1) {
      if (column < row.length) row[column] = null
    }
  }

  await writeLocalSheet(sheetName, rows)
}

/** Nomes canônicos das abas na ordem do schema (para a exportação). */
export function localSheetNames(): readonly SheetName[] {
  return SHEET_NAMES
}
