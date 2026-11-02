import type { RepositoryContext } from '@/domain/repositories/ports'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import type { SpreadsheetWorkspace } from '@/domain/workspace'
import { invalidateSpreadsheetCache } from '@/infrastructure/cache'
import { ChaveNecessariaError } from '@/infrastructure/cripto/envelope'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import {
  DEFAULT_DATABASE_TITLE,
  alterarCriptografia,
  batchGetValues as batchGetValuesDoCofre,
  batchUpdateValues,
  createDefaultSpreadsheet,
  listDatabaseWorkspaces,
  loadSpreadsheetWorkspace,
} from '@/infrastructure/driveFile/gateway'
import { ensureAppFolder } from '@/infrastructure/drive'
import { isJsonBackend } from '@/infrastructure/googleConfig'
import {
  SheetsApiError,
  batchGetValues,
  columnLetter,
  describeSheetsError,
  getValues,
} from '@/infrastructure/sheets/gateway'
import type { ValueRange } from '@/infrastructure/sheets/gateway'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Migração de um banco **legado em Google Sheets** para o cofre JSON do Drive
 * (`PLANO_CRIPTOGRAFIA.md` §5.5, §6.6, Fase 8).
 *
 * A regra de ouro é **não destruir nada**: a planilha antiga só é lida (um único
 * `batchGet` pela Sheets API, com fallback aba a aba quando alguma aba do
 * schema não existe) e nunca recebe escrita, exclusão ou ajuste de cabeçalho. O
 * cofre novo é criado ao lado e o workspace ativo passa a apontar para ele
 * quando o usuário aceita a oferta.
 */

/** `true` quando o Google negou permissão para ler a planilha antiga (403). */
export const MSG_MIGRACAO_SEM_ESCOPO =
  'O Google não autorizou a leitura da planilha antiga. Migre manualmente: abra a planilha, gere um .ods e importe no app.'

/** A planilha antiga não está mais acessível (excluída ou em outra conta). */
export const MSG_PLANILHA_ANTIGA_AUSENTE =
  'A planilha antiga não foi encontrada no Google. Verifique se ela ainda existe e se a conta tem acesso.'

/** O cofre já existe, mas está cifrado e essa sessão não tem a chave. */
export const MSG_COFRE_CRIPTOGRAFADO =
  'Já existe um banco novo com este nome e ele está criptografado. Abra-o pela lista de bancos informando a chave.'

/** URL de edição de uma planilha do Google Sheets (o banco criado antes do upgrade). */
const URL_PLANILHA_SHEETS = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/?#]+/

/**
 * `true` quando o workspace ativo é um banco do **formato antigo**: backend
 * `json` ligado, mas o workspace aponta para uma planilha do Google Sheets
 * (`docs.google.com/spreadsheets/d/…`) gravada antes da migração.
 *
 * O arquivo do cofre novo usa `drive.google.com/file/d/…` e por isso não é
 * confundido com o legado.
 */
export function detectarBancoLegado(workspace: SpreadsheetWorkspace | null): boolean {
  if (!workspace || !isJsonBackend()) return false
  const url = workspace.spreadsheetUrl
  if (typeof url !== 'string' || url.length === 0) return false
  return URL_PLANILHA_SHEETS.test(url)
}

/** Intervalo A1 completo de uma aba do schema (todas as colunas do schema). */
export function rangeDaAba(nome: SheetName): string {
  return `'${nome}'!A1:${columnLetter(SHEET_HEADERS[nome].length)}`
}

/**
 * Intervalo de **leitura** da planilha antiga.
 *
 * Vai além da última coluna do schema (`ZZ`) porque o usuário pode ter criado
 * colunas extras na planilha antiga: migrar "sem perda" exige lê-las.
 */
export function rangeDaAbaLegada(nome: SheetName): string {
  return `'${nome}'!A1:ZZ`
}

/** Opções da migração. */
export interface OpcoesMigracao {
  /** Com a chave o cofre nasce cifrado e a sessão já fica desbloqueada. */
  chave?: SessaoCripto
  /** Título do banco novo (padrão: o mesmo título usado na criação). */
  title?: string
}

/** Resultado da migração — nunca lança: a UI decide o que mostrar. */
export type ResultadoMigracao =
  | { status: 'migrado'; workspace: SpreadsheetWorkspace; abas: number }
  | { status: 'ja-existia'; workspace: SpreadsheetWorkspace }
  | { status: 'erro'; mensagem: string }

/**
 * Monta a matriz a gravar no cofre a partir da aba da planilha antiga.
 *
 * Segue a mesma semântica conservadora de `format.ts#withCompletedHeader` (e de
 * `ensureLocalSheetsWithHeaders`): a linha 1 lida é **preservada** (nomes
 * editados e colunas extras no fim continuam válidos) e só o **sufixo** do
 * cabeçalho do schema que ainda falta é completado, a partir da última célula
 * preenchida. Linhas de dados nunca são truncadas; quando a planilha antiga tem
 * menos colunas que o schema, elas são completadas com `''` até a largura da
 * aba — o banco antigo migra **sem perda**.
 */
function abaParaGravacao(
  nome: SheetName,
  valores: readonly CellValue[][],
): CellValue[][] | null {
  if (valores.length === 0) return null

  const schema = SHEET_HEADERS[nome]
  const cabecalho = [...valores[0]]

  let ultimaPreenchida = -1
  for (let coluna = 0; coluna < cabecalho.length; coluna += 1) {
    if (!celulaVazia(cabecalho[coluna])) ultimaPreenchida = coluna
  }
  for (let coluna = ultimaPreenchida + 1; coluna < schema.length; coluna += 1) {
    cabecalho[coluna] = schema[coluna]
  }

  const largura = Math.max(cabecalho.length, schema.length)
  const dados = valores.slice(1).map((linha) => {
    const celulas = [...linha]
    while (celulas.length < largura) celulas.push('')
    return celulas
  })
  return [cabecalho, ...dados]
}

/** `true` para célula ausente/nula/em branco (mesmo critério de `format.ts`). */
function celulaVazia(valor: CellValue | undefined): boolean {
  if (valor === null || valor === undefined) return true
  return typeof valor === 'string' && valor.trim().length === 0
}

/** Traduz a falha da migração para a mensagem da UI (§6.7). */
function mensagemDeMigracao(erro: unknown): string {
  if (erro instanceof SheetsApiError) {
    if (erro.status === 401) return 'Sessão expirada. Faça login novamente.'
    if (erro.status === 403) return MSG_MIGRACAO_SEM_ESCOPO
    if (erro.status === 404) return MSG_PLANILHA_ANTIGA_AUSENTE
    if (erro.status === 429) return 'Cota da API do Google excedida. Tente novamente em instantes.'
  }
  return describeSheetsError(erro)
}

/**
 * Lê as abas da planilha antiga em uma única chamada.
 *
 * Planilhas criadas por versões anteriores do app podem não ter todas as abas
 * do schema; nesse caso o `batchGet` falha inteiro ("Unable to parse range"). O
 * fallback lê aba a aba e ignora apenas as inexistentes — assim o banco antigo
 * migra com o que ele realmente tem, em vez de falhar por causa de uma aba nova.
 */
async function lerAbasLegadas(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
): Promise<ValueRange[]> {
  try {
    return await batchGetValues(accessToken, spreadsheetId, ranges, 'FORMULA')
  } catch (erro) {
    if (!(erro instanceof SheetsApiError) || erro.status !== 400) throw erro

    const lidas: ValueRange[] = []
    for (const range of ranges) {
      try {
        const values = await getValues(accessToken, spreadsheetId, range, 'FORMULA')
        lidas.push({ range, values })
      } catch (falha) {
        if (!(falha instanceof SheetsApiError) || falha.status !== 400) throw falha
        lidas.push({ range, values: [] })
      }
    }
    return lidas
  }
}

/**
 * `true` quando o cofre existente só tem cabeçalhos (nenhuma linha de dados).
 *
 * É o rastro de uma migração interrompida depois de criar o arquivo: esse cofre
 * precisa ser preenchido, não tratado como "já existia".
 */
async function cofreVazio(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
): Promise<boolean> {
  const lidas = await batchGetValuesDoCofre(accessToken, spreadsheetId, ranges)
  return lidas.every((aba) => (aba.values?.length ?? 0) <= 1)
}

/**
 * Pasta do app onde o cofre deve nascer (`databases_app_minhas_acoes`).
 *
 * Criada/descoberta antes da criação do arquivo para que ele já nasça lá dentro
 * (o `drive.file` permite criar dentro de uma pasta criada pelo app). Falha na
 * pasta não impede a migração: o cofre fica na raiz, como antes.
 */
async function pastaDoApp(accessToken: string): Promise<string | undefined> {
  try {
    return await ensureAppFolder(accessToken)
  } catch {
    return undefined
  }
}

/**
 * Copia as abas do banco legado para um cofre JSON no Drive.
 *
 * `context` aponta para a **planilha antiga** (id + token). A idempotência vem
 * primeiro: um cofre existente **com dados** é apenas aberto e devolvido
 * (`ja-existia`, nada é regravado); um cofre existente **vazio** (migração
 * interrompida) é preenchido no mesmo arquivo — sem criar outro — e a resposta é
 * `migrado`. Cofre cifrado sem a chave na sessão devolve erro, nunca adivinha.
 */
export async function migrarPlanilhaAntiga(
  context: RepositoryContext,
  opcoes: OpcoesMigracao = {},
): Promise<ResultadoMigracao> {
  const title = opcoes.title?.trim() || DEFAULT_DATABASE_TITLE

  try {
    const ranges = SHEET_NAMES.map(rangeDaAba)
    const rangesLeitura = SHEET_NAMES.map(rangeDaAbaLegada)
    let destino: SpreadsheetWorkspace | null = null

    const [existente] = await listDatabaseWorkspaces(context.accessToken, title)
    if (existente) {
      let workspace: SpreadsheetWorkspace
      try {
        workspace = await loadSpreadsheetWorkspace(context.accessToken, existente.spreadsheetId)
      } catch (erro) {
        if (erro instanceof ChaveNecessariaError) {
          return { status: 'erro', mensagem: MSG_COFRE_CRIPTOGRAFADO }
        }
        throw erro
      }

      if (!(await cofreVazio(context.accessToken, workspace.spreadsheetId, ranges))) {
        return { status: 'ja-existia', workspace }
      }
      destino = workspace
    }

    // `FORMULA` preserva as fórmulas do Consolidado (a planilha antiga continua
    // sendo a "superfície de cálculo") e, para células comuns, devolve o valor
    // bruto — datas como serial, números como number — que é o que os codecs e
    // o formato do cofre esperam. Não ler com `FORMATTED_VALUE`: os textos
    // "R$ 1.234,56" quebrariam preços e datas.
    const lidas = await lerAbasLegadas(context.accessToken, context.spreadsheetId, rangesLeitura)

    const data = SHEET_NAMES.flatMap((nome, index) => {
      const values = abaParaGravacao(nome, lidas[index]?.values ?? [])
      return values ? [{ range: rangesLeitura[index], values }] : []
    })

    const alvo =
      destino ??
      (await createDefaultSpreadsheet(context.accessToken, title, {
        ...(opcoes.chave ? { chave: opcoes.chave } : {}),
        folderId: await pastaDoApp(context.accessToken),
      }))
    if (data.length > 0) {
      await batchUpdateValues(context.accessToken, alvo.spreadsheetId, data)
    }

    // Cofre reaproveitado ainda em claro: honra o pedido de banco criptografado
    // do usuário (o arquivo já existe, então cifra em vez de recriar).
    if (destino && opcoes.chave && alvo.criptografia !== 'total') {
      await alterarCriptografia(context.accessToken, alvo.spreadsheetId, opcoes.chave)
    }

    // O cache das abas da planilha antiga deixa de ser usado: o banco ativo
    // passa a ser o cofre novo (chaveado por outro id).
    invalidateSpreadsheetCache(context.spreadsheetId)

    const workspace: SpreadsheetWorkspace =
      destino && opcoes.chave ? { ...alvo, criptografia: 'total' } : alvo
    return { status: 'migrado', workspace, abas: data.length }
  } catch (erro) {
    return { status: 'erro', mensagem: mensagemDeMigracao(erro) }
  }
}
