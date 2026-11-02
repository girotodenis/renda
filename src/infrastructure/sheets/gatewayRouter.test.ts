import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODO_LOCAL } from '@/domain/armazenamento'
import { MAGIC } from '@/domain/criptografia'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import { gunzip } from '@/infrastructure/compression'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Teste de fiação do roteador: o mesmo `gatewayRouter` atende os repositórios
 * com a planilha do Sheets (padrão) ou com o arquivo JSON no Drive
 * (`VITE_GOOGLE_BACKEND=json`). A rede é substituída por um stub de `fetch`.
 */

type Router = typeof import('@/infrastructure/sheets/gatewayRouter')

interface Chamada {
  url: string
  method: string
  body: unknown
}

const LINHA: CellValue[] = ['id-1', '2026-01-05', 'Compra', 'Ações', 'PETR4', 10, 30.5]

function jsonResponse(json: unknown, etag?: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(etag === undefined ? {} : { ETag: `"${etag}"` }),
    json: async () => json,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

function bytesResponse(bytes: Uint8Array): Response {
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

function corpoBinario(body: unknown): Uint8Array {
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (body instanceof Uint8Array) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  return new Uint8Array()
}

/** Drive falso mínimo (um arquivo) usado pelo backend `json`. */
function stubDrive(inicial?: { bytes?: Uint8Array }) {
  const estado: { bytes: Uint8Array; etag: string; versao: number } = {
    bytes: inicial?.bytes ?? new Uint8Array(),
    etag: 'etag-1',
    versao: 1,
  }
  const chamadas: Chamada[] = []

  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    chamadas.push({ url, method, body: init?.body })

    if (method === 'POST' && url.includes('/drive/v3/files')) {
      return jsonResponse({ id: 'arquivo-1', name: 'Carteira.json.gz' }, estado.etag)
    }
    if (method === 'PATCH' && url.includes('/upload/drive/v3/files/')) {
      estado.bytes = corpoBinario(init?.body)
      estado.versao += 1
      estado.etag = `etag-${estado.versao}`
      return jsonResponse({ id: 'arquivo-1' }, estado.etag)
    }
    if (url.includes('alt=media')) return bytesResponse(estado.bytes)
    if (url.includes('/drive/v3/files/arquivo-1')) {
      return jsonResponse({ id: 'arquivo-1', name: 'Carteira.json.gz' }, estado.etag)
    }
    throw new Error(`Requisição inesperada no Drive: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', spy)

  return { chamadas }
}

/** Stub mínimo da API do Sheets, com as abas do schema (garante o padrão). */
function stubSheets() {
  const chamadas: string[] = []
  const metadados = {
    spreadsheetId: 'planilha-1',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/planilha-1/edit',
    properties: { title: 'Carteira' },
    sheets: SHEET_NAMES.map((nome, indice) => ({ properties: { sheetId: indice, title: nome } })),
  }

  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    chamadas.push(url)
    return jsonResponse(url.includes('/values/') ? { values: [LINHA] } : metadados)
  })
  vi.stubGlobal('fetch', spy)
  return { chamadas }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('gatewayRouter', () => {
  it('com VITE_GOOGLE_BACKEND=json grava e lê o arquivo JSON do Drive', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', 'json')
    const drive = stubDrive()
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')

    const workspace = await router.criarWorkspace('token', 'Carteira')
    await router.appendValues('token', workspace.spreadsheetId, "'Operacoes'!A2:L", [LINHA])
    const linhas = await router.getValues('token', workspace.spreadsheetId, "'Operacoes'!A2:L")

    expect(linhas).toEqual([LINHA])
    expect(workspace.spreadsheetUrl).toBe('https://drive.google.com/file/d/arquivo-1/view')
    expect(drive.chamadas.some((chamada) => chamada.url.includes('sheets.googleapis.com'))).toBe(
      false,
    )

    const texto = new TextDecoder().decode(await gunzip(corpoBinario(drive.chamadas.at(-1)?.body)))
    expect(texto).toContain('PETR4')
  })

  it('sem o flag (ou com valor desconhecido) continua usando a API do Google Sheets', async () => {
    // `''` representa "flag ausente" sem depender do `.env` de quem roda os testes.
    vi.stubEnv('VITE_GOOGLE_BACKEND', '')
    const sheets = stubSheets()
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')

    const workspace = await router.criarWorkspace('token', 'Carteira')
    const linhas = await router.getValues('token', workspace.spreadsheetId, "'Operacoes'!A2:L")

    expect(workspace.spreadsheetId).toBe('planilha-1')
    expect(linhas).toEqual([LINHA])
    expect(sheets.chamadas.every((url) => url.includes('sheets.googleapis.com'))).toBe(true)
  })

  it('com backend json repassa a chave na criação e lê o estado pela magic', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', 'json')
    const drive = stubDrive()
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')
    const cripto = await import('@/infrastructure/cripto/envelope')
    const sessao = await cripto.criarSessao('senha', { iteracoes: 1000 })

    const workspace = await router.criarWorkspace('token', 'Carteira', { chave: sessao })

    expect(workspace.criptografia).toBe('total')
    const enviado = corpoBinario(drive.chamadas.find((chamada) => chamada.method === 'PATCH')?.body)
    expect(new TextDecoder().decode(enviado.subarray(0, MAGIC.length))).toBe(MAGIC)
    expect(await router.estadoCriptografia('token', workspace.spreadsheetId)).toEqual({
      estado: 'total',
      bloqueado: false,
    })
    expect(router.criptografiaDisponivel()).toBe(true)
  })

  it('no backend sheets recusa alterarCriptografia e responde sem criptografia', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', '')
    stubSheets()
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')
    const cripto = await import('@/infrastructure/cripto/envelope')
    const sessao = await cripto.criarSessao('senha', { iteracoes: 1000 })

    const erro = await router
      .alterarCriptografia('token', 'planilha-1', sessao)
      .catch((falha: unknown) => falha)

    expect(erro).toBeInstanceOf(router.SheetsApiError)
    expect(erro).toMatchObject({ status: 400 })
    expect(await router.estadoCriptografia('token', 'planilha-1')).toEqual({
      estado: 'nenhuma',
      bloqueado: false,
    })
    expect(router.criptografiaDisponivel()).toBe(false)
  })

  it('com backend json o desbloquear repassa ao cofre e libera a leitura', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', 'json')
    const cripto = await import('@/infrastructure/cripto/envelope')
    const container = await import('@/infrastructure/driveFile/container')
    const formato = await import('@/infrastructure/driveFile/format')
    const sessao = await cripto.criarSessao('senha', { iteracoes: 1000 })

    const vazio = formato.emptyDatabase()
    const drive = stubDrive({
      bytes: await container.codificarBanco(vazio.sheets, vazio.version, sessao),
    })
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')

    const workspace = await router.desbloquear('token', 'arquivo-1', 'senha')

    expect(workspace.criptografia).toBe('total')
    expect(workspace.title).toBe('Carteira')
    expect(await router.getValues('token', 'arquivo-1', "'Operacoes'!A2:L")).toEqual([])
    expect(drive.chamadas.filter((chamada) => chamada.method === 'PATCH')).toHaveLength(0)
  })

  it('fora do backend json o desbloquear rejeita com 400 e a mensagem da §6.7', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', '')
    stubSheets()
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')

    const erro = await router
      .desbloquear('token', 'planilha-1', 'senha')
      .catch((falha: unknown) => falha)

    expect(erro).toBeInstanceOf(router.SheetsApiError)
    expect(erro).toMatchObject({ status: 400 })
    expect((erro as Error).message).toContain('cofre JSON')
  })
})

describe('cofre do modo local', () => {
  it('responde o estado pelo cofre e fica disponível sem depender do backend', async () => {
    // Backend `sheets`: só o modo local pode cifrar neste cenário.
    vi.stubEnv('VITE_GOOGLE_BACKEND', '')
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')
    const modo = await import('@/infrastructure/modoArmazenamento')
    modo.setModoArmazenamento(MODO_LOCAL)

    expect(router.criptografiaDisponivel()).toBe(true)
    await expect(router.estadoCriptografia('', 'local')).resolves.toEqual({
      estado: 'nenhuma',
      bloqueado: false,
    })
  })

  it('ativar cifra as abas e desativar volta à matriz pura', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', '')
    const kv = await import('@/infrastructure/kvStore')
    const chaves = await import('@/infrastructure/cripto/chaveSessao')
    kv._resetForTests()
    chaves._resetChavesForTests()

    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')
    const modo = await import('@/infrastructure/modoArmazenamento')
    const local = await import('@/infrastructure/sheets/localGateway')
    const cripto = await import('@/infrastructure/cripto/envelope')
    modo.setModoArmazenamento(MODO_LOCAL)

    await local.localLoadWorkspace('2026-10-15T12:00:00.000Z')
    await local.localAppendValues("'Operacoes'!A1", [['a1', 'PETR4']])
    const linhaAba = [[...SHEET_HEADERS.Operacoes]]
    expect(await local.localGetValues("'Operacoes'!A1:B2")).toEqual([
      [...SHEET_HEADERS.Operacoes.slice(0, 2)],
      ['a1', 'PETR4'],
    ])

    const sessao = await cripto.criarSessao('senha', { iteracoes: 1000 })
    await router.alterarCriptografia('', 'local', sessao)

    await expect(router.estadoCriptografia('', 'local')).resolves.toEqual({
      estado: 'total',
      bloqueado: false,
    })
    expect(JSON.stringify(kv.kvGet('sheets', 'local-sheet::Operacoes'))).not.toContain('PETR4')
    // O banco continua legível na sessão que ativou a cifra.
    expect((await local.localGetValues("'Operacoes'!A1:B2"))[1]).toEqual(['a1', 'PETR4'])

    // Bloqueio: sem chave, nada é decifrado nem gravado.
    chaves.esquecerChave('local')
    await expect(router.estadoCriptografia('', 'local')).resolves.toEqual({
      estado: 'total',
      bloqueado: true,
    })
    await expect(local.localGetValues("'Operacoes'!A1:B2")).rejects.toBeInstanceOf(
      router.ChaveNecessariaError,
    )
    await expect(router.alterarCriptografia('', 'local', null)).rejects.toBeInstanceOf(
      router.ChaveNecessariaError,
    )

    // Desbloqueio pela senha do cofre.
    await expect(router.desbloquear('', 'local', 'senha errada')).rejects.toBeInstanceOf(
      router.ChaveIncorretaError,
    )
    const workspace = await router.desbloquear('', 'local', 'senha')
    expect(workspace.criptografia).toBe('total')
    expect((await local.localGetValues("'Operacoes'!A1:B2"))[1]).toEqual(['a1', 'PETR4'])

    await router.alterarCriptografia('', 'local', null)

    await expect(router.estadoCriptografia('', 'local')).resolves.toEqual({
      estado: 'nenhuma',
      bloqueado: false,
    })
    expect(kv.kvGet('sheets', 'local-sheet::Operacoes')).toEqual([...linhaAba, ['a1', 'PETR4']])
    expect(chaves.temChave('local')).toBe(false)
  })

  it('é idempotente: desativar um banco em claro não altera as abas', async () => {
    vi.stubEnv('VITE_GOOGLE_BACKEND', '')
    const kv = await import('@/infrastructure/kvStore')
    kv._resetForTests()
    const router: Router = await import('@/infrastructure/sheets/gatewayRouter')
    const modo = await import('@/infrastructure/modoArmazenamento')
    const local = await import('@/infrastructure/sheets/localGateway')
    modo.setModoArmazenamento(MODO_LOCAL)

    await local.localLoadWorkspace('2026-10-15T12:00:00.000Z')
    await local.localAppendValues("'Operacoes'!A1", [['a1', 'PETR4']])

    await router.alterarCriptografia('', 'local', null)

    expect(kv.kvGet('sheets', 'local-sheet::Operacoes')).toEqual([
      [...SHEET_HEADERS.Operacoes],
      ['a1', 'PETR4'],
    ])
  })
})
