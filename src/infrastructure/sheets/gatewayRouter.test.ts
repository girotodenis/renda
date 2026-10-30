import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHEET_NAMES } from '@/domain/sheetsSchema'
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
function stubDrive() {
  const estado: { bytes: Uint8Array; etag: string; versao: number } = {
    bytes: new Uint8Array(),
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
})
