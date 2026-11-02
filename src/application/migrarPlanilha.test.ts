import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpreadsheetWorkspace } from '@/domain/workspace'
import type { SheetIdMap } from '@/domain/workspace'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import {
  MSG_COFRE_CRIPTOGRAFADO,
  MSG_MIGRACAO_SEM_ESCOPO,
  detectarBancoLegado,
  migrarPlanilhaAntiga,
  rangeDaAba,
  rangeDaAbaLegada,
} from '@/application/migrarPlanilha'
import { ChaveNecessariaError } from '@/infrastructure/cripto/envelope'
import { SheetsApiError } from '@/infrastructure/sheets/gateway'

/**
 * Testes da migração do banco legado em Google Sheets para o cofre JSON.
 *
 * Todo o acesso externo (Drive, Sheets e cache local) é substituído por mocks:
 * o que importa aqui é a **ordem** das operações (idempotência primeiro), o
 * conteúdo copiado e a garantia de que a planilha antiga não recebe escrita.
 */

const mocks = vi.hoisted(() => ({
  listDatabaseWorkspaces: vi.fn(),
  loadSpreadsheetWorkspace: vi.fn(),
  createDefaultSpreadsheet: vi.fn(),
  alterarCriptografia: vi.fn(),
  batchUpdateValues: vi.fn(),
  batchGetValuesCofre: vi.fn(),
  batchGetValues: vi.fn(),
  getValues: vi.fn(),
  invalidateSpreadsheetCache: vi.fn(),
  isJsonBackend: vi.fn(() => true),
}))

vi.mock('@/infrastructure/driveFile/gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/driveFile/gateway')>()
  return {
    ...real,
    listDatabaseWorkspaces: mocks.listDatabaseWorkspaces,
    loadSpreadsheetWorkspace: mocks.loadSpreadsheetWorkspace,
    createDefaultSpreadsheet: mocks.createDefaultSpreadsheet,
    alterarCriptografia: mocks.alterarCriptografia,
    batchUpdateValues: mocks.batchUpdateValues,
    batchGetValues: mocks.batchGetValuesCofre,
  }
})

vi.mock('@/infrastructure/sheets/gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/sheets/gateway')>()
  return { ...real, batchGetValues: mocks.batchGetValues, getValues: mocks.getValues }
})

vi.mock('@/infrastructure/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/cache')>()
  return { ...real, invalidateSpreadsheetCache: mocks.invalidateSpreadsheetCache }
})

vi.mock('@/infrastructure/googleConfig', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/googleConfig')>()
  return { ...real, isJsonBackend: mocks.isJsonBackend }
})

const ID_ANTIGO = 'planilha-antiga'
const TOKEN = 'token'
const CONTEXTO = { accessToken: TOKEN, spreadsheetId: ID_ANTIGO }

function mapaDeAbas(): SheetIdMap {
  return Object.fromEntries(SHEET_NAMES.map((nome, indice) => [nome, indice])) as SheetIdMap
}

const WORKSPACE_NOVO: SpreadsheetWorkspace = {
  spreadsheetId: 'cofre-1',
  title: 'Carteira',
  spreadsheetUrl: 'https://drive.google.com/file/d/cofre-1/view',
  sheetIds: mapaDeAbas(),
  updatedAt: '2026-11-02T12:00:00.000Z',
  criptografia: 'nenhuma',
}

function workspaceAntigo(url: string | null = 'https://docs.google.com/spreadsheets/d/planilha-antiga/edit'): SpreadsheetWorkspace {
  return { ...WORKSPACE_NOVO, spreadsheetId: ID_ANTIGO, spreadsheetUrl: url, sheetIds: mapaDeAbas() }
}

/** Resposta do `batchGet` com cabeçalho e uma linha de dados em cada aba. */
function abasLidas() {
  return SHEET_NAMES.map((nome) => ({
    range: rangeDaAba(nome),
    values: [[...SHEET_HEADERS[nome]], [`linha-${nome}`]],
  }))
}

/** Cofre existente **vazio**: só a linha de cabeçalho em cada aba. */
function cofreVazio() {
  return SHEET_NAMES.map((nome) => ({
    range: rangeDaAba(nome),
    values: [[...SHEET_HEADERS[nome]]],
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isJsonBackend.mockReturnValue(true)
  mocks.listDatabaseWorkspaces.mockResolvedValue([])
  mocks.batchGetValues.mockResolvedValue(abasLidas())
  mocks.batchGetValuesCofre.mockResolvedValue(abasLidas())
  mocks.createDefaultSpreadsheet.mockResolvedValue(WORKSPACE_NOVO)
  mocks.alterarCriptografia.mockResolvedValue(undefined)
  mocks.batchUpdateValues.mockResolvedValue(undefined)
  mocks.getValues.mockResolvedValue([])
  mocks.loadSpreadsheetWorkspace.mockResolvedValue(WORKSPACE_NOVO)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('detectarBancoLegado', () => {
  it('reconhece a planilha do Sheets e ignora o arquivo do cofre no Drive', () => {
    expect(detectarBancoLegado(workspaceAntigo())).toBe(true)
    // Um cofre já migrado aponta para o Drive, não para o Sheets.
    expect(
      detectarBancoLegado(workspaceAntigo('https://drive.google.com/file/d/cofre-1/view')),
    ).toBe(false)
    expect(detectarBancoLegado(workspaceAntigo(null))).toBe(false)
    expect(detectarBancoLegado(null)).toBe(false)
  })

  it('não oferece migração no build `sheets`', () => {
    mocks.isJsonBackend.mockReturnValue(false)
    expect(detectarBancoLegado(workspaceAntigo())).toBe(false)
  })
})

describe('migrarPlanilhaAntiga', () => {
  it('copia as abas para um cofre novo sem tocar na planilha antiga', async () => {
    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    expect(resultado).toEqual({ status: 'migrado', workspace: WORKSPACE_NOVO, abas: SHEET_NAMES.length })

    // Leitura: uma única chamada à Sheets API, preservando fórmulas (e as
    // colunas além do schema, por isso o intervalo vai até ZZ).
    expect(mocks.batchGetValues).toHaveBeenCalledTimes(1)
    expect(mocks.batchGetValues).toHaveBeenCalledWith(
      TOKEN,
      ID_ANTIGO,
      SHEET_NAMES.map(rangeDaAbaLegada),
      'FORMULA',
    )

    // Escrita: só no cofre novo, em uma única chamada.
    expect(mocks.createDefaultSpreadsheet).toHaveBeenCalledWith(TOKEN, 'Carteira', {})
    expect(mocks.batchUpdateValues).toHaveBeenCalledTimes(1)

    const [token, destino, data] = mocks.batchUpdateValues.mock.calls[0] as [
      string,
      string,
      { range: string; values: (string | number | boolean | null)[][] }[],
    ]
    expect(token).toBe(TOKEN)
    expect(destino).toBe('cofre-1')
    expect(data).toHaveLength(SHEET_NAMES.length)
    expect(mocks.batchUpdateValues).not.toHaveBeenCalledWith(
      TOKEN,
      ID_ANTIGO,
      expect.anything(),
      expect.anything(),
    )

    // Cabeçalho do schema + linha de dados (completada até a largura da aba).
    const operacoes = data.find((aba) => aba.range === rangeDaAbaLegada('Operacoes'))
    expect(operacoes?.values[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(operacoes?.values[1]?.[0]).toBe('linha-Operacoes')
    expect(operacoes?.values[1]).toHaveLength(SHEET_HEADERS.Operacoes.length)

    // O cache da planilha antiga deixa de ser usado.
    expect(mocks.invalidateSpreadsheetCache).toHaveBeenCalledWith(ID_ANTIGO)
  })

  it('é idempotente: com o cofre já existente devolve `ja-existia` e não grava nada', async () => {
    mocks.listDatabaseWorkspaces.mockResolvedValue([
      { spreadsheetId: 'cofre-1', title: 'Carteira' },
    ])

    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    expect(resultado).toEqual({ status: 'ja-existia', workspace: WORKSPACE_NOVO })
    expect(mocks.loadSpreadsheetWorkspace).toHaveBeenCalledWith(TOKEN, 'cofre-1')
    expect(mocks.batchGetValuesCofre).toHaveBeenCalledWith(TOKEN, 'cofre-1', SHEET_NAMES.map(rangeDaAba))
    expect(mocks.batchGetValues).not.toHaveBeenCalled()
    expect(mocks.createDefaultSpreadsheet).not.toHaveBeenCalled()
    expect(mocks.batchUpdateValues).not.toHaveBeenCalled()
    expect(mocks.invalidateSpreadsheetCache).not.toHaveBeenCalled()
  })

  it('preenche um cofre existente vazio (migração interrompida) e devolve `migrado`', async () => {
    const cofreExistente = { ...WORKSPACE_NOVO, spreadsheetId: 'cofre-vazio' }
    mocks.listDatabaseWorkspaces.mockResolvedValue([
      { spreadsheetId: 'cofre-vazio', title: 'Carteira' },
    ])
    mocks.loadSpreadsheetWorkspace.mockResolvedValue(cofreExistente)
    mocks.batchGetValuesCofre.mockResolvedValue(cofreVazio())

    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    expect(resultado).toEqual({
      status: 'migrado',
      workspace: cofreExistente,
      abas: SHEET_NAMES.length,
    })
    // Continua no mesmo arquivo: nenhum cofre novo é criado.
    expect(mocks.createDefaultSpreadsheet).not.toHaveBeenCalled()
    expect(mocks.batchUpdateValues).toHaveBeenCalledTimes(1)
    expect(mocks.batchUpdateValues).toHaveBeenCalledWith(
      TOKEN,
      'cofre-vazio',
      expect.any(Array),
    )
  })

  it('cifra o cofre reaproveitado quando a chave é informada', async () => {
    const chave = { chave: {} } as unknown as NonNullable<
      Parameters<typeof migrarPlanilhaAntiga>[1]
    >['chave']
    mocks.listDatabaseWorkspaces.mockResolvedValue([
      { spreadsheetId: 'cofre-vazio', title: 'Carteira' },
    ])
    mocks.loadSpreadsheetWorkspace.mockResolvedValue({
      ...WORKSPACE_NOVO,
      spreadsheetId: 'cofre-vazio',
      criptografia: 'nenhuma',
    })
    mocks.batchGetValuesCofre.mockResolvedValue(cofreVazio())

    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira', chave })

    expect(mocks.alterarCriptografia).toHaveBeenCalledWith(TOKEN, 'cofre-vazio', chave)
    expect(resultado).toMatchObject({
      status: 'migrado',
      workspace: { spreadsheetId: 'cofre-vazio', criptografia: 'total' },
    })
  })

  it('preserva cabeçalho editado e colunas extras da planilha antiga', async () => {
    const cabecalho = SHEET_HEADERS.Operacoes.map((coluna, indice) =>
      indice === 4 ? 'Ticker (editado)' : coluna,
    ).concat('Observação')
    const linha = [...SHEET_HEADERS.Operacoes.map(() => 'x'), 'minha nota']
    mocks.batchGetValues.mockResolvedValue(
      SHEET_NAMES.map((nome) => ({
        range: rangeDaAba(nome),
        values:
          nome === 'Operacoes' ? [cabecalho, linha] : [[...SHEET_HEADERS[nome]], [`linha-${nome}`]],
      })),
    )

    await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    const data = mocks.batchUpdateValues.mock.calls[0]?.[2] as {
      range: string
      values: (string | number | boolean | null)[][]
    }[]
    const operacoes = data.find((aba) => aba.range === rangeDaAbaLegada('Operacoes'))

    // Nome editado e coluna extra no fim continuam como estavam.
    expect(operacoes?.values[0]).toEqual(cabecalho)
    // Nenhuma coluna da linha de dados foi truncada.
    expect(operacoes?.values[1]).toEqual(linha)
  })

  it('completa só o sufixo do cabeçalho do schema quando a planilha antiga tem menos colunas', async () => {
    const cabecalho = ['ID', 'Data', 'Tipo']
    const linha = ['id-1', '2026-01-05', 'Compra']
    mocks.batchGetValues.mockResolvedValue(
      SHEET_NAMES.map((nome) => ({
        range: rangeDaAba(nome),
        values:
          nome === 'Operacoes' ? [cabecalho, linha] : [[...SHEET_HEADERS[nome]], [`linha-${nome}`]],
      })),
    )

    await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    const data = mocks.batchUpdateValues.mock.calls[0]?.[2] as {
      range: string
      values: (string | number | boolean | null)[][]
    }[]
    const operacoes = data.find((aba) => aba.range === rangeDaAbaLegada('Operacoes'))
    const [gravado, dados] = operacoes?.values ?? [[], []]

    expect(gravado).toEqual([...cabecalho, ...SHEET_HEADERS.Operacoes.slice(3)])
    // Linha de dados preservada e completada com vazios até a largura do schema.
    expect(dados).toHaveLength(SHEET_HEADERS.Operacoes.length)
    expect(dados?.slice(0, 3)).toEqual(linha)
    expect(dados?.slice(3).every((celula) => celula === '')).toBe(true)
  })

  it('não inventa acesso a um cofre existente que está criptografado', async () => {
    mocks.listDatabaseWorkspaces.mockResolvedValue([
      { spreadsheetId: 'cofre-1', title: 'Carteira' },
    ])
    mocks.loadSpreadsheetWorkspace.mockRejectedValue(new ChaveNecessariaError())

    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    expect(resultado).toEqual({ status: 'erro', mensagem: MSG_COFRE_CRIPTOGRAFADO })
    expect(mocks.batchGetValues).not.toHaveBeenCalled()
    expect(mocks.batchUpdateValues).not.toHaveBeenCalled()
  })

  it('devolve erro amigável quando o escopo é negado e oferece o caminho manual', async () => {
    mocks.batchGetValues.mockRejectedValue(
      new SheetsApiError(403, 'Request had insufficient authentication scopes.'),
    )

    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    expect(resultado).toEqual({ status: 'erro', mensagem: MSG_MIGRACAO_SEM_ESCOPO })
    expect(mocks.createDefaultSpreadsheet).not.toHaveBeenCalled()
    expect(mocks.batchUpdateValues).not.toHaveBeenCalled()
    expect(mocks.invalidateSpreadsheetCache).not.toHaveBeenCalled()
  })

  it('migra mesmo quando a planilha antiga não tem todas as abas do schema', async () => {
    mocks.batchGetValues.mockRejectedValue(
      new SheetsApiError(400, 'Unable to parse range: \'Valuation\'!A1:H'),
    )
    mocks.getValues.mockImplementation(async (_token: string, _id: string, range: string) => {
      if (range === rangeDaAbaLegada('Valuation')) {
        throw new SheetsApiError(400, 'Unable to parse range')
      }
      return [[...SHEET_HEADERS.Operacoes], ['linha-Operacoes']]
    })

    const resultado = await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira' })

    expect(resultado).toMatchObject({ status: 'migrado', abas: SHEET_NAMES.length - 1 })
    const data = mocks.batchUpdateValues.mock.calls[0]?.[2] as { range: string }[]
    expect(data.map((aba) => aba.range)).not.toContain(rangeDaAbaLegada('Valuation'))
  })

  it('cria o cofre cifrado quando a chave é informada', async () => {
    // A sessão só é repassada: derivar/detectar bytes é responsabilidade do gateway.
    const chave = { chave: {} } as unknown as NonNullable<
      Parameters<typeof migrarPlanilhaAntiga>[1]
    >['chave']

    await migrarPlanilhaAntiga(CONTEXTO, { title: 'Carteira', chave })

    expect(mocks.createDefaultSpreadsheet).toHaveBeenCalledWith(TOKEN, 'Carteira', { chave })
  })
})
