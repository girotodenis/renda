import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Operacao } from '@/domain/entities'
import type { RepositoryContext } from '@/domain/repositories/ports'
import { gunzip } from '@/infrastructure/compression'
import { DRIVE_FILES_ENDPOINT } from '@/infrastructure/driveFile/api'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Integração do fluxo **local-first** com o gateway do arquivo JSON do Drive.
 *
 * Prova o contrato que motivou a mudança: salvar não fala com o Google e o
 * flush assíncrono grava a fila inteira com **um único upload**.
 *
 * A rede é um Drive falso em memória (mesma abordagem do
 * `driveFile/gateway.test.ts`): guarda bytes/etag do arquivo, valida `If-Match`
 * e registra cada chamada.
 */

const TITULO = 'Minhas Ações — Carteira'

interface Chamada {
  url: string
  method: string
}

interface DriveFalso {
  id: string
  nome: string
  bytes: Uint8Array
  etag: string
  versao: number
  chamadas: Chamada[]
  enviados: Uint8Array[]
}

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

function criarDriveFalso(): DriveFalso {
  const drive: DriveFalso = {
    id: 'arquivo-1',
    nome: `${TITULO}.json.gz`,
    bytes: new Uint8Array(),
    etag: 'etag-1',
    versao: 1,
    chamadas: [],
    enviados: [],
  }

  const fetchFalso = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    drive.chamadas.push({ url, method })

    if (method === 'POST') {
      const corpo = JSON.parse(String(init?.body ?? '{}')) as { name?: string }
      if (typeof corpo.name === 'string') drive.nome = corpo.name
      return respostaJson({ id: drive.id, name: drive.nome }, drive.etag)
    }

    if (method === 'PATCH') {
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

function uploads(drive: DriveFalso): number {
  return drive.chamadas.filter((chamada) => chamada.method === 'PATCH').length
}

function downloads(drive: DriveFalso): number {
  return drive.chamadas.filter(
    (chamada) => chamada.method === 'GET' && chamada.url.includes('alt=media'),
  ).length
}

async function abasEnviadas(bytes: Uint8Array): Promise<Record<string, CellValue[][]>> {
  const texto = new TextDecoder().decode(await gunzip(bytes))
  return (JSON.parse(texto) as { sheets: Record<string, CellValue[][]> }).sheets
}

function operacao(ticker: string): Operacao {
  return {
    id: 'op-1',
    data: '2026-10-10',
    tipo: OperacaoTipo.Compra,
    categoria: CategoriaAtivo.Acao,
    ticker,
    quantidade: 10,
    precoUnitario: 2500,
    taxas: 0,
    indexador: null,
    percentualIndexador: null,
    vencimento: null,
    valorBrutoAtual: null,
  }
}

type Repos = typeof import('@/infrastructure/repositories')
type Sync = typeof import('@/application/sync')
type Outbox = typeof import('@/infrastructure/outbox')

let drive: DriveFalso
let repos: Repos
let sync: Sync
let outbox: Outbox
let context: RepositoryContext

beforeEach(async () => {
  // O gateway guarda o arquivo em cache por módulo: recarregar garante uma
  // sessão nova (e um Drive novo) em cada teste.
  vi.resetModules()
  const kvStore = await import('@/infrastructure/kvStore')
  kvStore._resetForTests()
  const modo = await import('@/infrastructure/modoArmazenamento')
  modo._resetModoArmazenamentoForTests()
  const chaves = await import('@/infrastructure/cripto/chaveSessao')
  chaves.esquecerTodasAsChaves()

  drive = criarDriveFalso()
  const gateway = await import('@/infrastructure/driveFile/gateway')
  const workspace = await gateway.createDefaultSpreadsheet('token', TITULO)

  repos = await import('@/infrastructure/repositories')
  sync = await import('@/application/sync')
  outbox = await import('@/infrastructure/outbox')

  context = { accessToken: 'token', spreadsheetId: workspace.spreadsheetId }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('escrita local-first (integração com o Drive)', () => {
  it('salvar não acessa a rede e o flush grava a fila com um único upload', async () => {
    // Aquece o cache das abas (é o estado que a UI lê).
    await repos.prefetchAllSheets(context)
    drive.chamadas.length = 0

    const nova = operacao('PETR4')
    const retorno = await repos.operacoesRepo.append(context, nova)

    expect(retorno).toBe(nova)
    expect(drive.chamadas).toEqual([])
    expect(outbox.count()).toBe(1)
    expect(repos.operacoesRepo.readCache(context.spreadsheetId)).toEqual([nova])

    const resultado = await sync.sincronizarPendentes(context)

    expect(resultado).toMatchObject({ aplicadas: 1, pendentes: 0 })
    expect(resultado.erro).toBeUndefined()
    expect(uploads(drive)).toBe(1)
    // O arquivo já estava em memória: o flush não baixa de novo.
    expect(downloads(drive)).toBe(0)

    const enviado = drive.enviados.at(-1)
    expect(enviado).toBeDefined()
    const abas = await abasEnviadas(enviado as Uint8Array)
    expect(abas.Operacoes?.some((linha) => linha[4] === 'PETR4')).toBe(true)

    // Fila vazia e cache reidratado com a linha gravada.
    expect(outbox.count()).toBe(0)
    expect(repos.operacoesRepo.readCache(context.spreadsheetId)?.map((o) => o.ticker)).toEqual([
      'PETR4',
    ])
  })

  it('várias escritas na mesma janela custam um único upload', async () => {
    await repos.prefetchAllSheets(context)
    drive.chamadas.length = 0

    await repos.operacoesRepo.append(context, operacao('PETR4'))
    await repos.operacoesRepo.append(context, { ...operacao('VALE3'), id: 'op-2' })
    await repos.operacoesRepo.append(context, { ...operacao('ITUB4'), id: 'op-3' })

    expect(drive.chamadas).toEqual([])
    expect(outbox.count()).toBe(3)

    const resultado = await sync.sincronizarPendentes(context)

    expect(resultado.pendentes).toBe(0)
    expect(uploads(drive)).toBe(1)

    const abas = await abasEnviadas(drive.enviados.at(-1) as Uint8Array)
    const tickers = (abas.Operacoes ?? []).slice(1).map((linha) => linha[4])
    expect(tickers).toEqual(['PETR4', 'VALE3', 'ITUB4'])
  })
})
