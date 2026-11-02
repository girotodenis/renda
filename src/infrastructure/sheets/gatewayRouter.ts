import type { SheetName } from '@/domain/sheetsSchema'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { PlanilhaExistente, SpreadsheetWorkspace } from '@/domain/workspace'
import type { RepositoryContext } from '@/domain/repositories/ports'
import { isCriptografiaSuportada } from '@/infrastructure/cripto/webCrypto'
import { ChaveIncorretaError } from '@/infrastructure/cripto/envelope'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import { esquecerChave, guardarChave, temChave } from '@/infrastructure/cripto/chaveSessao'
import {
  ID_COFRE_LOCAL,
  abrirCofreLocal,
  criarCofreLocal,
  removerCofreLocal,
  temCofreLocal,
} from '@/infrastructure/cripto/localCofre'
import * as driveFile from '@/infrastructure/driveFile/gateway'
import type { EstadoCriptografia } from '@/infrastructure/driveFile/gateway'
import { isJsonBackend } from '@/infrastructure/googleConfig'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import * as sheets from '@/infrastructure/sheets/gateway'
import type { ValueInputOption, ValueRange, ValueRenderOption } from '@/infrastructure/sheets/gateway'
import * as local from '@/infrastructure/sheets/localGateway'
import { listLocalSheetNames, readLocalSheet, writeLocalSheet } from '@/infrastructure/sheets/localSheets'
import type { SheetMatrix } from '@/infrastructure/sheets/localSheets'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Roteador de origem de dados (RF01/RF02) — a única decisão "nuvem vs. local"
 * do app.
 *
 * Expõe **a mesma superfície** do gateway de células e escolhe o adaptador pelo
 * modo ativo (`local` ou `google`) e, no modo Google, pelo backend de build
 * (`VITE_GOOGLE_BACKEND`): planilha do Google Sheets ou um arquivo JSON
 * compactado no Drive. Assim, repositórios e casos de uso permanecem agnósticos
 * à origem: nenhum deles conhece `isModoLocal()` nem o backend.
 *
 * Erros e utilitários puros continuam sendo reexportados do gateway do Sheets
 * (não há equivalente local: o IndexedDB não falha por rede/quota). O gateway
 * JSON lança o mesmo `SheetsApiError` (com `status`), então `isQuotaError`,
 * `describeSheetsError` e o fallback automático para o outbox funcionam igual.
 *
 * Os adaptadores são importados por **namespace** para que as funções deste
 * módulo possam ter os mesmos nomes das originais sem recursão acidental.
 */

export { columnLetter, describeSheetsError, isQuotaError, SheetsApiError } from '@/infrastructure/sheets/gateway'
export type {
  ValueInputOption,
  ValueRange,
  ValueRenderOption,
} from '@/infrastructure/sheets/gateway'

/**
 * Erros e tipos de criptografia reexportados para a camada de aplicação não
 * precisar importar o adaptador concreto (`driveFile/gateway`).
 */
export { ChaveIncorretaError, ChaveNecessariaError } from '@/infrastructure/cripto/envelope'
export type { SessaoCripto } from '@/infrastructure/cripto/envelope'
export type { EstadoCriptografia } from '@/infrastructure/driveFile/gateway'

/** Opções da criação do banco (só o cofre JSON as usa por enquanto). */
export interface OpcoesCriarWorkspace {
  /** Sessão de criptografia: com ela o arquivo já nasce cifrado. */
  chave?: SessaoCripto
}

const CRIPTOGRAFIA_INDISPONIVEL =
  'Disponível no cofre JSON e no modo local; no Google Sheets as células precisam ficar legíveis.'

/** Adaptador do modo Google, escolhido em tempo de build pelo backend. */
const google = isJsonBackend() ? driveFile : sheets

/** Quantas requisições de rede foram feitas ao backend Google (diagnóstico). */
export function getSheetsRequestCount(): number {
  return google.getSheetsRequestCount()
}

/** Zera o contador de requisições (uso no diagnóstico de cache). */
export function resetSheetsRequestCount(): void {
  google.resetSheetsRequestCount()
}

/** Nome do arquivo do banco no Drive (no backend Sheets, o próprio título). */
export function nomeArquivoBanco(title: string): string {
  return isJsonBackend() ? driveFile.databaseFileName(title) : title
}

/**
 * Lista os bancos já existentes no Drive com o nome derivado do título.
 *
 * Só o backend `json` lista arquivos (no backend `sheets` a planilha existente é
 * escolhida pelo Google Picker), por isso devolve `[]` fora dele.
 */
export async function listarBancosExistentes(
  accessToken: string,
  title: string,
): Promise<PlanilhaExistente[]> {
  if (isModoLocal() || !isJsonBackend()) return []
  return driveFile.listDatabaseWorkspaces(accessToken, title)
}

/**
 * Lista todos os bancos do Drive criados pelo app (mais recente primeiro).
 *
 * Devolve `[]` fora do backend `json`: no backend `sheets` a planilha existente
 * é escolhida pelo Google Picker, sem listagem.
 */
export async function listarBancosDisponiveis(
  accessToken: string,
): Promise<PlanilhaExistente[]> {
  if (isModoLocal() || !isJsonBackend()) return []
  return driveFile.listAllDatabaseWorkspaces(accessToken)
}

/**
 * Agrupa várias escritas em uma única ida à nuvem.
 *
 * No backend `json` as mutações ficam em memória e são gravadas juntas (1
 * download + 1 upload para toda a fila offline); nos demais adaptadores é um
 * pass-through. É o caminho usado pelo flush do `sync.ts`.
 */
export function executarEmLote<T>(
  accessToken: string,
  spreadsheetId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (isModoLocal()) return fn()
  return google.executarEmLote(accessToken, spreadsheetId, fn)
}

/** Lê um intervalo de uma aba na origem ativa. */
export function getValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  renderOption?: ValueRenderOption,
): Promise<CellValue[][]> {
  if (isModoLocal()) return local.localGetValues(range)
  return google.getValues(accessToken, spreadsheetId, range, renderOption)
}

/** Lê vários intervalos na origem ativa (uma chamada no modo Google). */
export function batchGetValues(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
  renderOption?: ValueRenderOption,
): Promise<ValueRange[]> {
  if (isModoLocal()) return local.localBatchGetValues(ranges)
  return google.batchGetValues(accessToken, spreadsheetId, ranges, renderOption)
}

/** Escreve um intervalo na origem ativa. */
export function updateValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption?: ValueInputOption,
): Promise<void> {
  if (isModoLocal()) return local.localUpdateValues(range, values)
  return google.updateValues(accessToken, spreadsheetId, range, values, inputOption)
}

/** Escreve vários intervalos na origem ativa. */
export function batchUpdateValues(
  accessToken: string,
  spreadsheetId: string,
  data: readonly ValueRange[],
  inputOption?: ValueInputOption,
): Promise<void> {
  if (isModoLocal()) return local.localBatchUpdateValues(data)
  return google.batchUpdateValues(accessToken, spreadsheetId, data, inputOption)
}

/** Acrescenta linhas ao final da tabela na origem ativa. */
export function appendValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly CellValue[][],
  inputOption?: ValueInputOption,
): Promise<void> {
  if (isModoLocal()) return local.localAppendValues(range, values)
  return google.appendValues(accessToken, spreadsheetId, range, values, inputOption)
}

/** Limpa as células de um intervalo na origem ativa. */
export function clearValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  if (isModoLocal()) return local.localClearValues(range)
  return google.clearValues(accessToken, spreadsheetId, range)
}

/**
 * Locale da "planilha" ativa — define o separador das fórmulas. No modo local
 * não há API: usa-se `pt_BR` (o `.ods` exportado também é pt-BR).
 */
export function getSpreadsheetLocale(
  accessToken: string,
  spreadsheetId: string,
  options?: { forceRefresh?: boolean },
): Promise<string | null> {
  if (isModoLocal()) return Promise.resolve(local.LOCAL_SHEET_LOCALE)
  return google.getSpreadsheetLocale(accessToken, spreadsheetId, options)
}

/** Garante as abas obrigatórias na origem ativa (criação é local no modo local). */
export function ensureRequiredSheets(accessToken: string, spreadsheetId: string): Promise<number> {
  if (isModoLocal()) return local.localEnsureRequiredSheets()
  return google.ensureRequiredSheets(accessToken, spreadsheetId)
}

/**
 * Garante os cabeçalhos do schema nas abas já existentes (migração de colunas
 * novas em planilhas antigas). No modo local apenas completa a matriz do
 * IndexedDB, sem rede.
 */
export function ensureSheetHeaders(accessToken: string, spreadsheetId: string): Promise<number> {
  if (isModoLocal()) return local.localEnsureSheetHeaders()
  return google.ensureSheetHeaders(accessToken, spreadsheetId)
}

/** Cria o workspace inicial da origem ativa (abas do schema + cabeçalhos, RF02). */
export function criarWorkspace(
  accessToken: string,
  title?: string,
  opcoes: OpcoesCriarWorkspace = {},
): Promise<SpreadsheetWorkspace> {
  if (isModoLocal()) return local.localLoadWorkspace(new Date().toISOString())
  if (isJsonBackend()) return driveFile.createDefaultSpreadsheet(accessToken, title, opcoes)
  return sheets.createDefaultSpreadsheet(accessToken, title)
}

/**
 * Liga/desliga a criptografia do banco ativo.
 *
 * No backend `sheets` as células precisam ficar legíveis (as fórmulas do Sheets
 * são do próprio usuário), então a operação é recusada com 400 e mensagem
 * explícita. No modo local o cofre é o próprio IndexedDB (`localCofre`) e as
 * abas são regravadas cifradas/em claro.
 */
export async function alterarCriptografia(
  accessToken: string,
  spreadsheetId: string,
  chave: SessaoCripto | null,
): Promise<void> {
  if (isModoLocal()) return alterarCriptografiaLocal(chave)
  if (isJsonBackend()) return driveFile.alterarCriptografia(accessToken, spreadsheetId, chave)
  throw new sheets.SheetsApiError(400, CRIPTOGRAFIA_INDISPONIVEL)
}

/**
 * Ativa/desativa o cofre do banco local regravando todas as abas.
 *
 * As matrizes são lidas **antes** de trocar o estado do cofre: na ativação elas
 * ainda estão em claro; na desativação é a chave da sessão que as decifra. Se a
 * leitura falhar (cofre ativo sem chave), nada é alterado. Idempotente nos dois
 * sentidos: ativar um banco já cifrado recifra com a sessão informada e
 * desativar um banco em claro não faz nada.
 */
async function alterarCriptografiaLocal(sessao: SessaoCripto | null): Promise<void> {
  if (!sessao && !temCofreLocal()) return

  const abas: Array<{ nome: string; valores: SheetMatrix }> = []
  for (const nome of listLocalSheetNames()) {
    abas.push({ nome, valores: await readLocalSheet(nome) })
  }

  if (sessao) {
    await criarCofreLocal(sessao)
    guardarChave(ID_COFRE_LOCAL, sessao)
  } else {
    // Remover o cofre **antes** de regravar: as escritas passam a ser em claro.
    removerCofreLocal()
  }

  try {
    for (const aba of abas) await writeLocalSheet(aba.nome, aba.valores)
  } finally {
    if (!sessao) esquecerChave(ID_COFRE_LOCAL)
  }
}

/**
 * Desbloqueia o banco ativo com a senha do cofre (`PLANO_CRIPTOGRAFIA.md` §6.1).
 *
 * No cofre JSON e no modo local a senha é conferida pelo verificador/cofre
 * gravado neste dispositivo; no backend `sheets` as células precisam ficar
 * legíveis — daí o 400 com a mensagem da §6.7.
 */
export function desbloquear(
  accessToken: string,
  spreadsheetId: string,
  senha: string,
): Promise<SpreadsheetWorkspace> {
  if (isModoLocal()) return desbloquearLocal(senha)
  if (isJsonBackend()) return driveFile.desbloquear(accessToken, spreadsheetId, senha)
  return Promise.reject(new sheets.SheetsApiError(400, CRIPTOGRAFIA_INDISPONIVEL))
}

/** Abre o cofre local e deixa a chave em memória para as abas cifradas. */
async function desbloquearLocal(senha: string): Promise<SpreadsheetWorkspace> {
  const sessao = await abrirCofreLocal(senha)
  if (!sessao) throw new ChaveIncorretaError()

  guardarChave(ID_COFRE_LOCAL, sessao)
  return local.localLoadWorkspace(new Date().toISOString())
}

/**
 * Estado da criptografia do banco ativo (lido dos bytes/do cofre, sem precisar
 * da chave). No modo local o "arquivo" é o cofre no IndexedDB.
 */
export function estadoCriptografia(
  accessToken: string,
  spreadsheetId: string,
): Promise<EstadoCriptografia> {
  if (isModoLocal()) {
    const cofre = temCofreLocal()
    return Promise.resolve({
      estado: cofre ? 'total' : 'nenhuma',
      bloqueado: cofre && !temChave(ID_COFRE_LOCAL),
    })
  }
  if (isJsonBackend()) {
    return driveFile.estadoCriptografia(accessToken, spreadsheetId)
  }
  return Promise.resolve({ estado: 'nenhuma', bloqueado: false })
}

/**
 * `true` quando o backend ativo consegue cifrar o banco e o navegador tem Web
 * Crypto (exige HTTPS ou localhost). O modo local tem cofre próprio no
 * IndexedDB; o backend `sheets` fica de fora (células legíveis).
 */
export function criptografiaDisponivel(): boolean {
  return (isJsonBackend() || isModoLocal()) && isCriptografiaSuportada()
}

/**
 * Prepara (cria ou reabre) o workspace local do modo sem Google.
 * Idempotente: preserva o que já está no banco do navegador — inclusive a marca
 * de criptografia, que vem do cofre local.
 */
export function prepararWorkspaceLocal(): Promise<SpreadsheetWorkspace> {
  return local.localLoadWorkspace(new Date().toISOString())
}

/** Carrega o workspace existente da origem ativa (garantindo as abas). */
export function abrirWorkspace(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetWorkspace> {
  if (isModoLocal()) return local.localLoadWorkspace(new Date().toISOString())
  return google.loadSpreadsheetWorkspace(accessToken, spreadsheetId)
}

/** Uma aba pronta para exportação (cabeçalho + dados). */
export interface AbaExportada {
  nome: SheetName
  valores: CellValue[][]
}

/** Intervalo A1 completo de uma aba do schema (todas as colunas). */
export function rangeCompletoDaAba(nome: SheetName): string {
  return `'${nome}'!A1:${google.columnLetter(SHEET_HEADERS[nome].length)}`
}

/**
 * Lê todas as abas do schema (cabeçalho + dados) para gerar o arquivo `.ods`.
 * No modo Google usa um único `batchGet`; no modo local, o IndexedDB.
 */
export async function lerAbasParaExportacao(
  context: RepositoryContext,
): Promise<AbaExportada[]> {
  const ranges = SHEET_NAMES.map((nome) => rangeCompletoDaAba(nome))
  const valueRanges = await batchGetValues(context.accessToken, context.spreadsheetId, ranges)

  return SHEET_NAMES.map((nome, index) => ({
    nome,
    valores: valueRanges[index]?.values ?? [],
  }))
}
