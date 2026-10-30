import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import { gunzip, gzip } from '@/infrastructure/compression'
import { DRIVE_FILES_ENDPOINT, DRIVE_UPLOAD_ENDPOINT } from '@/infrastructure/driveFile/api'
import { emptyDatabase } from '@/infrastructure/driveFile/format'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Testes do gateway do arquivo JSON (mesma superfície do Sheets).
 *
 * A rede é substituída por um **Drive falso em memória**: guarda os bytes e o
 * etag de um único arquivo, valida `If-Match` (412 quando o etag não bate),
 * responde metadados/criação/listagem e devolve o corpo enviado para inspeção.
 */

type Gateway = typeof import('@/infrastructure/driveFile/gateway')

const TITULO = 'Minhas Ações — Carteira'
const SUFIXO = '.json.gz'
const ETAG_INICIAL = 'etag-1'

interface Chamada {
  url: string
  method: string
  headers: Headers
  body: unknown
}

interface DriveFalso {
  id: string
  nome: string
  bytes: Uint8Array
  etag: string
  versao: number
  chamadas: Chamada[]
  enviados: Uint8Array[]
  falharRede: boolean
}

/* --------------------------------------------------------------------------
 * Drive falso
 * ------------------------------------------------------------------------ */

function respostaJson(json: unknown, etag?: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(etag === undefined ? {} : { ETag: `"${etag}"` }),
    json: async () => json,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

function respostaBytes(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => {
      throw new Error('Resposta binária não tem JSON')
    },
    arrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer,
  } as unknown as Response
}

function respostaErro(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({ error: { message: `Falha simulada (HTTP ${status})` } }),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

function corpoBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return new Uint8Array(body)
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  throw new Error('Corpo da requisição não é binário')
}

async function compactar(raw: unknown): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(raw)))
}

async function descompactar(bytes: Uint8Array): Promise<Record<string, CellValue[][]>> {
  const texto = new TextDecoder().decode(await gunzip(bytes))
  return (JSON.parse(texto) as { sheets: Record<string, CellValue[][]> }).sheets
}

function criarDriveFalso(seed?: {
  id?: string
  nome?: string
  bytes?: Uint8Array
}): DriveFalso {
  const drive: DriveFalso = {
    id: seed?.id ?? 'arquivo-1',
    nome: seed?.nome ?? `${TITULO}${SUFIXO}`,
    bytes: seed?.bytes ?? new Uint8Array(),
    etag: ETAG_INICIAL,
    versao: 1,
    chamadas: [],
    enviados: [],
    falharRede: false,
  }

  const fetchFalso = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    drive.chamadas.push({ url, method, headers, body: init?.body })

    if (drive.falharRede) throw new TypeError('fetch failed')

    if (method === 'POST') {
      const corpo = JSON.parse(String(init?.body ?? '{}')) as { name?: string }
      if (typeof corpo.name === 'string') drive.nome = corpo.name
      return respostaJson({ id: drive.id, name: drive.nome }, drive.etag)
    }

    if (method === 'PATCH') {
      if (!url.startsWith(DRIVE_UPLOAD_ENDPOINT)) {
        throw new Error(`Upload inesperado: ${url}`)
      }
      const ifMatch = headers.get('If-Match')
      if (ifMatch !== null && ifMatch !== drive.etag) return respostaErro(412)

      drive.bytes = corpoBytes(init?.body)
      drive.versao += 1
      drive.etag = `etag-${drive.versao}`
      drive.enviados.push(drive.bytes)
      return respostaJson({ id: drive.id }, drive.etag)
    }

    if (url.includes('alt=media')) return respostaBytes(drive.bytes)
    if (url.includes('fields=files')) {
      return respostaJson({ files: [{ id: drive.id, name: drive.nome }] })
    }
    if (url.startsWith(DRIVE_FILES_ENDPOINT)) {
      return respostaJson({ id: drive.id, name: drive.nome }, drive.etag)
    }
    throw new Error(`Requisição inesperada: ${method} ${url}`)
  })

  vi.stubGlobal('fetch', fetchFalso)
  return drive
}

function contar(drive: DriveFalso, predicado: (chamada: Chamada) => boolean): number {
  return drive.chamadas.filter(predicado).length
}

/** Downloads do arquivo (`?alt=media`), sem contar os metadados. */
function downloads(drive: DriveFalso): number {
  return contar(drive, (chamada) => chamada.method === 'GET' && chamada.url.includes('alt=media'))
}

/** Uploads do arquivo (`PATCH ...uploadType=media`). */
function escritas(drive: DriveFalso): number {
  return contar(drive, (chamada) => chamada.method === 'PATCH')
}

async function capturarErro(promessa: Promise<unknown>): Promise<Error & { status?: number }> {
  try {
    await promessa
  } catch (error) {
    return error as Error & { status?: number }
  }
  throw new Error('Esperava que a promessa fosse rejeitada')
}

function linhaOperacao(id: string, ticker: string): CellValue[] {
  return [id, '2026-01-05', 'Compra', 'Ações', ticker, 10, 30.5, 2, null, null, null, 305]
}

let gateway: Gateway

beforeEach(async () => {
  // O cache é por módulo: recarregar garante uma sessão nova em cada teste.
  vi.resetModules()
  gateway = await import('@/infrastructure/driveFile/gateway')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* --------------------------------------------------------------------------
 * Criação e workspace
 * ------------------------------------------------------------------------ */

describe('createDefaultSpreadsheet', () => {
  it('cria o arquivo (POST + upload) com as abas do schema e devolve o workspace', async () => {
    const drive = criarDriveFalso()

    const workspace = await gateway.createDefaultSpreadsheet('token', '  Carteira Teste  ')

    expect(drive.chamadas).toHaveLength(2)
    expect(drive.chamadas[0]?.method).toBe('POST')
    expect(drive.chamadas[1]?.method).toBe('PATCH')

    expect(workspace.spreadsheetId).toBe(drive.id)
    expect(workspace.title).toBe('Carteira Teste')
    expect(workspace.spreadsheetUrl).toBe(`https://drive.google.com/file/d/${drive.id}/view`)
    SHEET_NAMES.forEach((nome, indice) => {
      expect(workspace.sheetIds[nome]).toBe(indice)
    })

    const abas = await descompactar(drive.bytes)
    expect(Object.keys(abas)).toHaveLength(SHEET_NAMES.length)
    for (const nome of SHEET_NAMES) {
      expect(abas[nome]?.[0]).toEqual([...SHEET_HEADERS[nome]])
    }
  })

  it('usa o título padrão quando o nome é vazio', async () => {
    const drive = criarDriveFalso()

    const workspace = await gateway.createDefaultSpreadsheet('token', '   ')

    expect(workspace.title).toBe(TITULO)
    expect(drive.nome).toBe(`${TITULO}${SUFIXO}`)
  })
})

/* --------------------------------------------------------------------------
 * Valores
 * ------------------------------------------------------------------------ */

describe('valores', () => {
  it('appendValues grava no fim e getValues lê do cache (sem novo download)', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })
    const linha = linhaOperacao('id-1', 'PETR4')

    await gateway.appendValues('token', drive.id, "'Operacoes'!A2:L", [linha])

    expect(escritas(drive)).toBe(1)
    expect(downloads(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    expect(abas.Operacoes).toHaveLength(2)
    expect(abas.Operacoes?.[1]).toEqual(linha)

    const lido = await gateway.getValues('token', drive.id, "'Operacoes'!A2:L")
    expect(lido).toEqual([linha])
    // Segunda leitura: veio do cache em memória, nenhum download novo.
    expect(downloads(drive)).toBe(1)
  })

  it('updateValues aceita intervalo aberto e fechado, clearValues preserva o resto', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })
    const linha = linhaOperacao('id-1', 'PETR4')

    await gateway.updateValues('token', drive.id, "'Operacoes'!A2:L", [linha])
    expect(escritas(drive)).toBe(1)

    await gateway.updateValues('token', drive.id, "'Operacoes'!A2:C2", [
      ['id-1', '2026-01-07', 'Venda'],
    ])

    let abas = await descompactar(drive.bytes)
    expect(abas.Operacoes?.[1]).toEqual(['id-1', '2026-01-07', 'Venda', ...linha.slice(3)])

    await gateway.clearValues('token', drive.id, "'Operacoes'!B2:C2")

    abas = await descompactar(drive.bytes)
    expect(abas.Operacoes?.[1]?.[0]).toBe('id-1')
    expect(abas.Operacoes?.[1]?.[1]).toBeNull()
    expect(abas.Operacoes?.[1]?.[2]).toBeNull()
    expect(abas.Operacoes?.[1]?.[3]).toBe('Ações')
    expect(abas.Operacoes?.[1]?.[11]).toBe(305)
  })

  it('batchUpdateValues grava várias faixas em um único upload', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })

    await gateway.batchUpdateValues('token', drive.id, [
      {
        range: "'Proventos'!A2:G",
        values: [['p-1', '2026-01-10', '2026-01-15', 'Ações', 'PETR4', 'Dividendo', 12.5]],
      },
      { range: "'Historico'!A2:D", values: [['2026-01-31', 1000, 900, 100]] },
    ])

    expect(escritas(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    expect(abas.Proventos?.[1]?.[0]).toBe('p-1')
    expect(abas.Historico?.[1]).toEqual(['2026-01-31', 1000, 900, 100])
  })

  it('batchGetValues resolve vários intervalos com um único download', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })

    const ranges = await gateway.batchGetValues('token', drive.id, [
      "'Operacoes'!A1:L",
      "'Proventos'!A1:G",
      'invalido',
    ])

    expect(downloads(drive)).toBe(1)
    expect(ranges.map((valueRange) => valueRange.range)).toEqual([
      "'Operacoes'!A1:L",
      "'Proventos'!A1:G",
      'invalido',
    ])
    expect(ranges[0]?.values?.[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(ranges[1]?.values?.[0]).toEqual([...SHEET_HEADERS.Proventos])
    expect(ranges[2]?.values).toEqual([])
  })

  it('intervalos inválidos e listas vazias não geram upload', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })

    await gateway.updateValues('token', drive.id, 'sem-endereco', [['x']])
    await gateway.updateValues('token', drive.id, "'Operacoes'!A2:L", [])
    await gateway.appendValues('token', drive.id, "'Operacoes'!A2:L", [])
    await gateway.clearValues('token', drive.id, '')
    await gateway.batchUpdateValues('token', drive.id, [])

    expect(escritas(drive)).toBe(0)
    expect(await gateway.getValues('token', drive.id, 'sem-endereco')).toEqual([])
  })
})

/* --------------------------------------------------------------------------
 * Abas e cabeçalhos
 * ------------------------------------------------------------------------ */

describe('abas e cabeçalhos', () => {
  it('ensureSheetHeaders completa o sufixo e é idempotente', async () => {
    const antigo = {
      version: 1,
      sheets: {
        Operacoes: [['Código', 'Data'], ['id-1', '2026-01-05']],
        Proventos: [[...SHEET_HEADERS.Proventos, 'Coluna Extra'], ['p-1']],
      },
    }
    const drive = criarDriveFalso({ bytes: await compactar(antigo) })

    expect(await gateway.ensureSheetHeaders('token', drive.id)).toBe(1)
    expect(escritas(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    // Nome editado preservado + sufixo do schema preenchido.
    expect(abas.Operacoes?.[0]).toEqual(['Código', 'Data', ...SHEET_HEADERS.Operacoes.slice(2)])
    // Cabeçalho já completo (com coluna extra) não é tocado.
    expect(abas.Proventos?.[0]).toEqual([...SHEET_HEADERS.Proventos, 'Coluna Extra'])

    expect(await gateway.ensureSheetHeaders('token', drive.id)).toBe(0)
    expect(escritas(drive)).toBe(1)
  })

  it('ensureRequiredSheets cria as abas ausentes de um arquivo antigo e é idempotente', async () => {
    const antigo = { version: 1, sheets: { Operacoes: [['ID'], ['id-1']] } }
    const drive = criarDriveFalso({ id: 'arquivo-2', bytes: await compactar(antigo) })

    expect(await gateway.ensureRequiredSheets('token', drive.id)).toBe(
      SHEET_NAMES.length - 1,
    )
    expect(escritas(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    expect(Object.keys(abas)).toHaveLength(SHEET_NAMES.length)
    expect(abas.Proventos?.[0]).toEqual([...SHEET_HEADERS.Proventos])
    // A aba existente é preservada como está.
    expect(abas.Operacoes).toEqual([['ID'], ['id-1']])

    expect(await gateway.ensureRequiredSheets('token', drive.id)).toBe(0)
    expect(escritas(drive)).toBe(1)
  })

  it('loadSpreadsheetWorkspace normaliza o arquivo antigo, persiste e devolve o workspace do Drive', async () => {
    const antigo = { version: 1, sheets: { Operacoes: [['ID', 'Data'], ['id-1', '2026-01-05']] } }
    const drive = criarDriveFalso({ bytes: await compactar(antigo) })

    const workspace = await gateway.loadSpreadsheetWorkspace('token', drive.id)

    expect(workspace.spreadsheetId).toBe(drive.id)
    expect(workspace.title).toBe(TITULO)
    expect(workspace.spreadsheetUrl).toBe(`https://drive.google.com/file/d/${drive.id}/view`)
    expect(downloads(drive)).toBe(1)
    expect(escritas(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    expect(Object.keys(abas)).toHaveLength(SHEET_NAMES.length)
    expect(abas.Operacoes?.[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(abas.Operacoes?.[1]).toEqual(['id-1', '2026-01-05'])

    // Já normalizado: a segunda abertura não grava nada.
    await gateway.loadSpreadsheetWorkspace('token', drive.id)
    expect(escritas(drive)).toBe(1)
  })
})

/* --------------------------------------------------------------------------
 * Lote e concorrência
 * ------------------------------------------------------------------------ */

describe('executarEmLote', () => {
  it('agrupa 3 appends em 1 download + 1 upload', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })
    const linhas = [linhaOperacao('id-1', 'PETR4'), linhaOperacao('id-2', 'VALE3'), linhaOperacao('id-3', 'ITSA4')]

    await gateway.executarEmLote('token', drive.id, async () => {
      for (const linha of linhas) {
        await gateway.appendValues('token', drive.id, "'Operacoes'!A2:L", [linha])
      }
    })

    expect(downloads(drive)).toBe(1)
    expect(escritas(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    expect(abas.Operacoes).toHaveLength(4)
    expect(abas.Operacoes?.slice(1)).toEqual(linhas)
  })

  it('grava o que já foi aplicado mesmo quando a função do lote falha', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })

    const erro = await capturarErro(
      gateway.executarEmLote('token', drive.id, async () => {
        await gateway.appendValues('token', drive.id, "'Operacoes'!A2:L", [
          linhaOperacao('id-1', 'PETR4'),
        ])
        throw new Error('falha no meio do lote')
      }),
    )

    expect(erro.message).toBe('falha no meio do lote')
    expect(escritas(drive)).toBe(1)

    const abas = await descompactar(drive.bytes)
    expect(abas.Operacoes).toHaveLength(2)
  })
})

describe('conflito de versão', () => {
  it('em 412 relê o arquivo, reaplica a mutação e grava sobre a versão remota', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })
    await gateway.getValues('token', drive.id, "'Operacoes'!A2:L")
    expect(downloads(drive)).toBe(1)

    // Outro dispositivo grava entre a leitura e a escrita.
    const remoto = emptyDatabase()
    remoto.sheets.Operacoes = [
      [...SHEET_HEADERS.Operacoes],
      linhaOperacao('outro-1', 'VALE3'),
    ]
    drive.bytes = await compactar(remoto)
    drive.etag = 'etag-externo'

    await gateway.appendValues('token', drive.id, "'Operacoes'!A2:L", [
      linhaOperacao('local-1', 'PETR4'),
    ])

    expect(escritas(drive)).toBe(2)
    expect(downloads(drive)).toBe(2)

    const abas = await descompactar(drive.bytes)
    const linhas = (abas.Operacoes ?? []).slice(1)
    expect(linhas).toHaveLength(2)
    expect(linhas[0]?.[0]).toBe('outro-1')
    expect(linhas[1]?.[0]).toBe('local-1')
  })
})

describe('persistência entre sessões', () => {
  it('um segundo navegador (cache novo) reabre o arquivo com os dados gravados', async () => {
    const drive = criarDriveFalso()
    await gateway.createDefaultSpreadsheet('token', 'Carteira')
    await gateway.appendValues('token', drive.id, "'Operacoes'!A2:L", [
      linhaOperacao('id-1', 'PETR4'),
    ])

    // Nova sessão: módulo recarregado, cache de banco vazio.
    vi.resetModules()
    const outraSessao: Gateway = await import('@/infrastructure/driveFile/gateway')

    const workspace = await outraSessao.loadSpreadsheetWorkspace('token', drive.id)
    const linhas = await outraSessao.getValues('token', drive.id, "'Operacoes'!A2:L")

    expect(workspace.spreadsheetId).toBe(drive.id)
    expect(workspace.title).toBe('Carteira')
    expect(linhas).toEqual([linhaOperacao('id-1', 'PETR4')])
    // A abertura baixa o arquivo uma única vez; a leitura seguinte vem do cache.
    expect(downloads(drive)).toBe(1)
  })
})

/* --------------------------------------------------------------------------
 * Falhas
 * ------------------------------------------------------------------------ */

describe('falhas de rede', () => {
  it('updateValues rejeita com SheetsApiError 0 e descarta o cache', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })
    await gateway.getValues('token', drive.id, "'Operacoes'!A2:L")
    expect(downloads(drive)).toBe(1)

    drive.falharRede = true
    const erro = await capturarErro(
      gateway.updateValues('token', drive.id, "'Operacoes'!A2:C2", [['x', 'y', 'z']]),
    )

    expect(erro).toBeInstanceOf(gateway.SheetsApiError)
    expect(erro.status).toBe(0)

    // A leitura seguinte não confia no estado local: baixa o arquivo de novo.
    drive.falharRede = false
    await gateway.getValues('token', drive.id, "'Operacoes'!A2:L")
    expect(downloads(drive)).toBe(2)
  })
})

/* --------------------------------------------------------------------------
 * Locale, nome do arquivo, listagem e contadores
 * ------------------------------------------------------------------------ */

describe('workspace e utilitários', () => {
  it('getSpreadsheetLocale é pt_BR sem rede e databaseFileName cai no título padrão', async () => {
    const drive = criarDriveFalso()

    expect(await gateway.getSpreadsheetLocale('token', drive.id)).toBe('pt_BR')
    expect(drive.chamadas).toHaveLength(0)

    expect(gateway.databaseFileName('  ')).toBe(`${TITULO}${SUFIXO}`)
    expect(gateway.databaseFileName(' Minha Carteira ')).toBe(`Minha Carteira${SUFIXO}`)
  })

  it('listDatabaseWorkspaces consulta pelo nome do arquivo e devolve ids/títulos', async () => {
    const drive = criarDriveFalso({ nome: `Minha Carteira${SUFIXO}`, bytes: new Uint8Array() })

    const lista = await gateway.listDatabaseWorkspaces('token', 'Minha Carteira')

    expect(drive.chamadas).toHaveLength(1)
    const url = new URL(String(drive.chamadas[0]?.url))
    expect(url.searchParams.get('q')).toBe(`name = 'Minha Carteira${SUFIXO}' and trashed = false`)
    expect(lista).toEqual([
      { spreadsheetId: drive.id, title: 'Minha Carteira', modificadaEm: null },
    ])
  })

  it('listAllDatabaseWorkspaces lista pelo sufixo do nome (sem depender do MIME)', async () => {
    const drive = criarDriveFalso({ nome: `Outro Banco${SUFIXO}` })

    const lista = await gateway.listAllDatabaseWorkspaces('token')

    expect(drive.chamadas).toHaveLength(1)
    const url = new URL(String(drive.chamadas[0]?.url))
    expect(url.searchParams.get('q')).toBe("trashed = false and name contains '.json.gz'")
    expect(lista).toEqual([{ spreadsheetId: drive.id, title: 'Outro Banco', modificadaEm: null }])
  })

  it('getSheetsRequestCount acompanha as requisições e resetSheetsRequestCount zera', async () => {
    const drive = criarDriveFalso({ bytes: await compactar(emptyDatabase()) })
    expect(gateway.getSheetsRequestCount()).toBe(0)

    await gateway.loadSpreadsheetWorkspace('token', drive.id)
    expect(gateway.getSheetsRequestCount()).toBe(2)

    await gateway.ensureRequiredSheets('token', drive.id)
    expect(gateway.getSheetsRequestCount()).toBe(2)

    gateway.resetSheetsRequestCount()
    expect(gateway.getSheetsRequestCount()).toBe(0)
  })
})
