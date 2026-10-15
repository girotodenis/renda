import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODO_GOOGLE, MODO_LOCAL, WORKSPACE_LOCAL_ID, isWorkspaceLocal } from '@/domain/armazenamento'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import { setModoArmazenamento } from '@/infrastructure/modoArmazenamento'
import {
  clearLocalSheets,
  ensureLocalSheetsWithHeaders,
  readLocalSheet,
} from '@/infrastructure/sheets/localSheets'
import {
  LOCAL_SHEET_LOCALE,
  localLoadWorkspace,
} from '@/infrastructure/sheets/localGateway'
import {
  appendValues,
  batchGetValues,
  clearValues,
  ensureRequiredSheets,
  getSpreadsheetLocale,
  getValues,
  updateValues,
} from '@/infrastructure/sheets/gatewayRouter'

beforeEach(() => {
  clearLocalSheets()
  // Sem isto o roteador falaria com a API do Google — os testes nunca devem
  // tocar a rede.
  setModoArmazenamento(MODO_LOCAL)
})

afterEach(() => {
  clearLocalSheets()
  setModoArmazenamento(MODO_GOOGLE)
  vi.unstubAllGlobals()
})

describe('ensureLocalSheetsWithHeaders', () => {
  it('cria todas as abas do schema com os cabeçalhos e é idempotente', () => {
    expect(ensureLocalSheetsWithHeaders()).toBe(SHEET_NAMES.length)
    expect(ensureLocalSheetsWithHeaders()).toBe(0)

    for (const name of SHEET_NAMES) {
      expect(readLocalSheet(name)[0]).toEqual([...SHEET_HEADERS[name]])
    }
  })
})

describe('escrita/leitura de intervalos', () => {
  it('grava e relê um intervalo preservando o cabeçalho', async () => {
    ensureLocalSheetsWithHeaders()

    await updateValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A2:B2", [['a1', 'PETR4']])

    expect(await getValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A1:B")).toEqual([
      [...SHEET_HEADERS.Operacoes.slice(0, 2)],
      ['a1', 'PETR4'],
    ])
  })

  it('acrescenta linhas ao final da tabela, na ordem', async () => {
    ensureLocalSheetsWithHeaders()

    await appendValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A1", [['a1']])
    await appendValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A1", [['a2']])

    expect(await getValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A1:A")).toEqual([
      ['ID'],
      ['a1'],
      ['a2'],
    ])
  })

  it('limpa apenas as colunas do intervalo', async () => {
    await updateValues('', WORKSPACE_LOCAL_ID, "'Consolidado'!A1:C2", [
      ['Ticker', 'Categoria', 'Valor'],
      ['PETR4', 'Acao', 100],
    ])

    await clearValues('', WORKSPACE_LOCAL_ID, "'Consolidado'!A1:B2")

    expect(readLocalSheet('Consolidado')[1]).toEqual([null, null, 100])
  })

  it('cresce a matriz quando a escrita passa do fim', async () => {
    await updateValues('', WORKSPACE_LOCAL_ID, "'Historico'!A5:B5", [['2026-10-15', 100]])

    expect(await getValues('', WORKSPACE_LOCAL_ID, "'Historico'!A5:B")).toEqual([
      ['2026-10-15', 100],
    ])
  })

  it('lê vários intervalos em uma única chamada local', async () => {
    ensureLocalSheetsWithHeaders()

    const result = await batchGetValues('', WORKSPACE_LOCAL_ID, [
      "'Operacoes'!A1:A",
      "'Proventos'!A1:A",
    ])

    expect(result).toHaveLength(2)
    expect(result[0].values?.[0]).toEqual(['ID'])
    expect(result[1].values?.[0]).toEqual(['ID'])
  })
})

describe('workspace local', () => {
  it('cria o workspace sintético garantindo as abas', async () => {
    const workspace = await localLoadWorkspace('2026-10-15T12:00:00.000Z')

    expect(isWorkspaceLocal(workspace.spreadsheetId)).toBe(true)
    expect(workspace.spreadsheetUrl).toBeNull()
    expect(Object.keys(workspace.sheetIds)).toEqual([...SHEET_NAMES])
    expect(readLocalSheet('Operacoes')[0]).toEqual([...SHEET_HEADERS.Operacoes])
  })
})

describe('roteamento por modo de armazenamento', () => {
  it('no modo local não toca a rede e responde do banco do navegador', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setModoArmazenamento(MODO_LOCAL)

    ensureLocalSheetsWithHeaders()
    await appendValues('', WORKSPACE_LOCAL_ID, "'Proventos'!A1", [['p1']])

    expect(await getValues('', WORKSPACE_LOCAL_ID, "'Proventos'!A1:A")).toEqual([['ID'], ['p1']])
    expect(await getSpreadsheetLocale('', WORKSPACE_LOCAL_ID)).toBe(LOCAL_SHEET_LOCALE)
    expect(await ensureRequiredSheets('', WORKSPACE_LOCAL_ID)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no modo google continua chamando a API do Sheets', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ values: [['do-google']] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    setModoArmazenamento(MODO_GOOGLE)

    const values = await getValues('token', 'planilha-1', "'Operacoes'!A1:A")

    expect(values).toEqual([['do-google']])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
