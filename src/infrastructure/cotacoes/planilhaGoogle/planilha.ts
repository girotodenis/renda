/**
 * Regras da **planilha de cotações** (aba única `Cotações`).
 *
 * A planilha é a superfície que executa o `GOOGLEFINANCE`: o app grava as
 * fórmulas uma vez por ticker e lê os preços com **um** `values.get` por
 * sincronização. Nada da carteira mora nela — se for apagada, é recriada.
 */

import { parseDecimalBR, toCentavos } from '@/domain/money'
import { ensureAppFolder } from '@/infrastructure/drive'
import { readStorageJson, removeStorageKey, writeStorageJson } from '@/infrastructure/storage'
import {
  buildGoogFinanceFormula,
  buildGoogFinanceOpenFormula,
  formulaSeparatorForLocale,
} from '@/infrastructure/sheets/sheetFormulas'
import type { FormulaSeparator } from '@/infrastructure/sheets/sheetFormulas'
import {
  ABA_COTACOES,
  criarPlanilhaCotacoes,
  descobrirPlanilhaCotacoes,
  escreverValores,
  garantirAba,
  garantirNaPasta,
  isNaoEncontrada,
  lerValores,
  limparValores,
} from '@/infrastructure/cotacoes/planilhaGoogle/api'

/** Cabeçalho da aba `Cotações` (mesma ordem das colunas A–D). */
export const CABECALHO = ['Ticker', 'Preço Atual', 'Preço Abertura', 'Variação Dia (%)']

/** Chave do id da planilha de cotações no `LocalStorage`. */
export const PLANILHA_STORAGE_KEY = 'minhaacoes.cotacoes.planilha.v1'

/**
 * Abaixo de R$ 0,20 o valor é tratado como "sem cotação": `GOOGLEFINANCE`
 * devolve 0/near-zero para tickers inválidos ou fora do pregão.
 */
const PRECO_MINIMO_CENTAVOS = 20

/** Cotação lida da planilha (valores em **centavos**). */
export interface CotacaoPlanilha {
  preco: number
  abertura: number | null
}

interface MetadadosCotacoes {
  spreadsheetId: string
  separador: FormulaSeparator
}

/** Metadados da última planilha acessada (evita reler locale/abas a cada sync). */
let metadados: MetadadosCotacoes | null = null

/**
 * `true` depois de conferir, nesta sessão, que a planilha está na pasta do app.
 * A conferência custa requisições: basta uma vez por planilha/sessão.
 */
let pastaConferida = false

/** Normaliza e remove duplicatas, preservando a ordem recebida. */
function normalizarTickers(tickers: readonly string[]): string[] {
  const vistos = new Set<string>()
  const resultado: string[] = []
  for (const ticker of tickers) {
    const normalizado = ticker.trim().toUpperCase()
    if (normalizado.length === 0 || vistos.has(normalizado)) continue
    vistos.add(normalizado)
    resultado.push(normalizado)
  }
  return resultado
}

/** Converte um valor da planilha (reais) em centavos; `null` quando inválido. */
export function parsePrecoPlanilha(valor: unknown): number | null {
  const reais =
    typeof valor === 'number'
      ? valor
      : typeof valor === 'string'
        ? parseDecimalBR(valor)
        : null
  if (reais === null || !Number.isFinite(reais) || reais <= 0) return null
  const centavos = toCentavos(reais)
  return centavos >= PRECO_MINIMO_CENTAVOS ? centavos : null
}

/** Lê o id salvo da planilha de cotações. */
function lerIdSalvo(): string | null {
  const id = readStorageJson<string>(PLANILHA_STORAGE_KEY)
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null
}

function salvarId(spreadsheetId: string): void {
  writeStorageJson(PLANILHA_STORAGE_KEY, spreadsheetId)
}

/** Garante que a aba exista e memoriza o locale (separador das fórmulas). */
async function resolverMetadados(
  token: string,
  spreadsheetId: string,
): Promise<MetadadosCotacoes> {
  if (metadados?.spreadsheetId === spreadsheetId) return metadados
  const dados = await garantirAba(token, spreadsheetId, ABA_COTACOES)
  metadados = {
    spreadsheetId,
    separador: formulaSeparatorForLocale(dados.locale),
  }
  return metadados
}

/**
 * Pasta do app (`databases_app_minhas_acoes`) onde a planilha de cotações deve ficar.
 *
 * `null` quando não foi possível garantir a pasta: a planilha é criada/usada na
 * raiz, como antes — cotações continuam funcionando.
 */
async function pastaDoApp(token: string): Promise<string | null> {
  try {
    return await ensureAppFolder(token)
  } catch {
    return null
  }
}

/** Move uma planilha já existente (id salvo/descoberto) para a pasta do app. */
async function conferirPasta(token: string, spreadsheetId: string): Promise<void> {
  if (pastaConferida) return
  const folderId = await pastaDoApp(token)
  if (!folderId) return
  await garantirNaPasta(token, spreadsheetId, folderId)
  pastaConferida = true
}

/**
 * Garante a planilha de cotações e devolve o id.
 *
 * Ordem: id salvo → descoberta por título (Drive, `drive.file`) → criação.
 * O id salvo que não responde mais (404) é descartado e a descoberta recomeça.
 */
export async function garantirPlanilha(token: string): Promise<string> {
  const salvo = lerIdSalvo()
  if (salvo !== null) {
    try {
      await resolverMetadados(token, salvo)
      await conferirPasta(token, salvo)
      return salvo
    } catch (error) {
      // 404 = apagada/arquivo inválido: recria. Outras falhas sobem para a
      // integração marcar `indisponivel` (403, rede, ...).
      if (!isNaoEncontrada(error)) throw error
      removeStorageKey(PLANILHA_STORAGE_KEY)
      metadados = null
    }
  }

  const descoberta = await descobrirPlanilhaCotacoes(token)
  if (descoberta !== null) {
    await resolverMetadados(token, descoberta)
    await conferirPasta(token, descoberta)
    salvarId(descoberta)
    return descoberta
  }

  const { spreadsheetId } = await criarPlanilhaCotacoes(token, {
    folderId: (await pastaDoApp(token)) ?? undefined,
  })
  pastaConferida = true
  await resolverMetadados(token, spreadsheetId)
  await escreverValores(token, spreadsheetId, `${ABA_COTACOES}!A1:D1`, [CABECALHO])
  salvarId(spreadsheetId)
  return spreadsheetId
}

/** Fórmula da variação do dia (%) a partir das colunas B (atual) e C (abertura). */
function buildVariacaoLinha(linha: number, separador: FormulaSeparator): string {
  return (
    `=IF(OR($C${linha}<=0${separador}$B${linha}<=0)${separador}""${separador}` +
    `($B${linha}-$C${linha})/$C${linha}*100)`
  )
}

/** Lê os tickers que já estão na coluna A (sem o cabeçalho). */
async function lerTickersDaPlanilha(token: string, spreadsheetId: string): Promise<string[]> {
  const linhas = await lerValores(token, spreadsheetId, `${ABA_COTACOES}!A2:A`)
  return normalizarTickers(
    linhas.flatMap((linha) => (typeof linha[0] === 'string' ? [linha[0]] : [])),
  )
}

/** `true` quando as duas listas têm os mesmos tickers na mesma ordem. */
function mesmaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((ticker, indice) => ticker === b[indice])
}

/**
 * Alinha a coluna A às posições abertas da carteira, regravando as fórmulas.
 *
 * A lista gravada é a **união** dos tickers pedidos com os que já estão na
 * planilha: a cadeia só envia o que ainda não tem preço, então substituir a
 * coluna apagaria tickers que voltaram a ser cotados por outra fonte. Só
 * escreve quando a união muda — o `GOOGLEFINANCE` é assíncrono e reescrever a
 * planilha a cada sincronização reiniciaria o cálculo sem necessidade.
 */
export async function reconciliarTickers(
  token: string,
  spreadsheetId: string,
  tickers: readonly string[],
): Promise<void> {
  const existentes = (await lerTickersDaPlanilha(token, spreadsheetId)).sort((a, b) =>
    a.localeCompare(b),
  )
  const desejados = [...new Set([...existentes, ...normalizarTickers(tickers)])].sort((a, b) =>
    a.localeCompare(b),
  )
  if (mesmaLista(existentes, desejados)) return

  const { separador } = await resolverMetadados(token, spreadsheetId)
  const linhas = desejados.map((ticker, indice) => {
    const linha = indice + 2
    return [
      ticker,
      buildGoogFinanceFormula(`$A${linha}`, separador),
      buildGoogFinanceOpenFormula(`$A${linha}`, separador),
      buildVariacaoLinha(linha, separador),
    ]
  })

  // Limpa antes: a planilha pode ter linhas sobrando (duplicatas, lixo manual)
  // que não fazem parte da união regravada.
  await limparValores(token, spreadsheetId, `${ABA_COTACOES}!A2:D`)
  if (linhas.length === 0) return
  await escreverValores(
    token,
    spreadsheetId,
    `${ABA_COTACOES}!A2:D${linhas.length + 1}`,
    linhas,
  )
}

/**
 * Lê os preços da planilha com **uma** requisição, de forma tolerante:
 * `#N/A`, célula vazia, texto, `0` e valores abaixo de R$ 0,20 são ignorados
 * (o ticker cai para as APIs da cadeia).
 */
export async function lerCotacoes(
  token: string,
  spreadsheetId: string,
  tickers: readonly string[],
): Promise<Map<string, CotacaoPlanilha>> {
  const desejados = new Set(normalizarTickers(tickers))
  const linhas = await lerValores(token, spreadsheetId, `${ABA_COTACOES}!A2:D`)
  const cotacoes = new Map<string, CotacaoPlanilha>()

  for (const linha of linhas) {
    const bruto = linha[0]
    const ticker = typeof bruto === 'string' ? bruto.trim().toUpperCase() : ''
    if (ticker.length === 0 || !desejados.has(ticker) || cotacoes.has(ticker)) continue
    const preco = parsePrecoPlanilha(linha[1])
    if (preco === null) continue
    cotacoes.set(ticker, { preco, abertura: parsePrecoPlanilha(linha[2]) })
  }

  return cotacoes
}

/** Esquece o id salvo da planilha (o próximo sync descobre/cria outra). */
export function limparPlanilhaCotacoes(): void {
  removeStorageKey(PLANILHA_STORAGE_KEY)
  metadados = null
}

/** Estado limpo para os testes (id salvo e metadados memorizados). */
export function _resetPlanilhaForTests(): void {
  limparPlanilhaCotacoes()
  metadados = null
  pastaConferida = false
}
