import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDatabaseFile,
  DATABASE_MIME_TYPE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DRIVE_FILES_ENDPOINT,
  DRIVE_UPLOAD_ENDPOINT,
  getDriveFileRequestCount,
  GoogleDriveFileError,
  listAllDatabaseFiles,
  listDatabaseFiles,
  readDatabaseFile,
  resetDriveFileRequestCount,
  writeDatabaseFile,
} from '@/infrastructure/driveFile/api'

/**
 * Testes das primitivas de rede do arquivo do banco no Drive (criar, ler,
 * escrever e listar). A rede é substituída por um stub de `fetch` para manter
 * os testes puros (ambiente `node`).
 */

interface RespostaFake {
  status?: number
  json?: unknown
  bytes?: Uint8Array
  headers?: Record<string, string>
}

interface ChamadaRegistrada {
  url: string
  method: string
  headers: Headers
  body: unknown
}

/** Resposta falsa com corpo JSON ou binário (`arrayBuffer`). */
function fakeResponse({ status = 200, json, bytes, headers }: RespostaFake): Response {
  const resposta = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers ?? {}),
    json: async () => {
      if (json === undefined) throw new Error('Resposta sem corpo JSON')
      return json
    },
    arrayBuffer: async () => {
      if (bytes === undefined) throw new Error('Resposta sem corpo binário')
      return new Uint8Array(bytes).buffer
    },
  }
  return resposta as unknown as Response
}

/** Instala um stub de `fetch` que devolve as respostas na ordem informada. */
function stubFetchSequence(respostas: RespostaFake[]) {
  const chamadas: ChamadaRegistrada[] = []
  let indice = 0
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
      body: init?.body,
    })
    const resposta = respostas[indice] ?? {}
    indice += 1
    return fakeResponse(resposta)
  })
  vi.stubGlobal('fetch', spy)
  return { spy, chamadas }
}

/** Bytes efetivamente enviados no corpo (aceita Uint8Array ou ArrayBuffer). */
function corpoBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  throw new Error('Corpo da requisição não é binário')
}

/** Executa a promessa e devolve o `GoogleDriveFileError` lançado. */
async function capturarErro(promessa: Promise<unknown>): Promise<GoogleDriveFileError> {
  try {
    await promessa
  } catch (error) {
    if (error instanceof GoogleDriveFileError) return error
    throw error
  }
  throw new Error('Esperava que a promessa fosse rejeitada')
}

const BYTES = new Uint8Array([31, 139, 8, 0, 1, 2, 3])

beforeEach(() => {
  resetDriveFileRequestCount()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createDatabaseFile', () => {
  it('cria os metadados e depois envia o conteúdo, devolvendo id/nome/etag', async () => {
    const { spy, chamadas } = stubFetchSequence([
      { json: { id: 'arquivo-1', name: 'minhasacoe.json.gz' } },
      { json: { id: 'arquivo-1', name: 'minhasacoe.json.gz' }, headers: { ETag: '"abc123"' } },
    ])

    const criado = await createDatabaseFile('token-abc', 'minhasacoe.json.gz', BYTES)

    expect(criado).toEqual({ fileId: 'arquivo-1', name: 'minhasacoe.json.gz', etag: 'abc123' })
    expect(spy).toHaveBeenCalledTimes(2)

    const [metadados, upload] = chamadas
    expect(metadados?.method).toBe('POST')
    expect(metadados?.url).toBe(`${DRIVE_FILES_ENDPOINT}?fields=id,name`)
    expect(metadados?.headers.get('Authorization')).toBe('Bearer token-abc')
    expect(metadados?.headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(metadados?.body))).toEqual({
      name: 'minhasacoe.json.gz',
      mimeType: DATABASE_MIME_TYPE,
    })

    expect(upload?.method).toBe('PATCH')
    expect(upload?.url).toBe(
      `${DRIVE_UPLOAD_ENDPOINT}/arquivo-1?uploadType=media&fields=id,name`,
    )
    expect(upload?.headers.get('Authorization')).toBe('Bearer token-abc')
    expect(upload?.headers.get('Content-Type')).toBe('application/gzip')
    expect(corpoBytes(upload?.body)).toEqual(BYTES)
  })
})

describe('readDatabaseFile', () => {
  it('lê os metadados e o conteúdo binário, devolvendo bytes e etag', async () => {
    const { spy, chamadas } = stubFetchSequence([
      { json: { id: 'arquivo-1', name: 'minhasacoe.json.gz' }, headers: { ETag: 'W/"v2"' } },
      { bytes: BYTES },
    ])

    const lido = await readDatabaseFile('token-abc', 'arquivo-1')

    expect(lido.bytes).toEqual(BYTES)
    expect(lido.etag).toBe('v2')
    expect(lido.name).toBe('minhasacoe.json.gz')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(chamadas[0]?.url).toBe(`${DRIVE_FILES_ENDPOINT}/arquivo-1?fields=id,name`)
    expect(chamadas[1]?.url).toBe(`${DRIVE_FILES_ENDPOINT}/arquivo-1?alt=media`)
    expect(chamadas[1]?.headers.get('Authorization')).toBe('Bearer token-abc')
  })

  it('propaga 404 mapeado quando o arquivo não existe', async () => {
    stubFetchSequence([{ status: 404 }])

    const erro = await capturarErro(readDatabaseFile('token-abc', 'inexistente'))

    expect(erro.status).toBe(404)
    expect(erro.message).toBe('Arquivo do banco de dados não encontrado no Google Drive.')
  })
})

describe('writeDatabaseFile', () => {
  it('envia If-Match com o etag atual e devolve o novo etag', async () => {
    const { spy, chamadas } = stubFetchSequence([{ json: { id: 'arquivo-1' }, headers: { ETag: '"v3"' } }])

    const resultado = await writeDatabaseFile('token-abc', 'arquivo-1', BYTES, 'v2')

    expect(resultado.etag).toBe('v3')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(chamadas[0]?.method).toBe('PATCH')
    expect(chamadas[0]?.url).toBe(`${DRIVE_UPLOAD_ENDPOINT}/arquivo-1?uploadType=media&fields=id`)
    expect(chamadas[0]?.headers.get('If-Match')).toBe('v2')
    expect(chamadas[0]?.headers.get('Content-Type')).toBe('application/gzip')
    expect(corpoBytes(chamadas[0]?.body)).toEqual(BYTES)
  })

  it('não envia If-Match quando o etag é null', async () => {
    const { chamadas } = stubFetchSequence([{ json: { id: 'arquivo-1' } }])

    const resultado = await writeDatabaseFile('token-abc', 'arquivo-1', BYTES, null)

    expect(resultado.etag).toBeNull()
    expect(chamadas[0]?.headers.get('If-Match')).toBeNull()
  })

  it('mapeia HTTP 412 como conflito de versão', async () => {
    stubFetchSequence([{ status: 412 }])

    const erro = await capturarErro(
      writeDatabaseFile('token-abc', 'arquivo-1', BYTES, 'v2'),
    )

    expect(erro.status).toBe(412)
    expect(erro.isConflict).toBe(true)
    expect(erro.message).toBe(
      'O banco de dados foi alterado em outro dispositivo. Recarregue e tente novamente.',
    )
  })
})

describe('mapeamento de erros HTTP', () => {
  it('401 indica sessão expirada', async () => {
    stubFetchSequence([{ status: 401 }])

    const erro = await capturarErro(listDatabaseFiles('token-abc', 'minhasacoe.json.gz'))

    expect(erro.status).toBe(401)
    expect(erro.message).toBe('Sessão expirada. Faça login novamente.')
  })

  it('403 indica permissão negada com dica sobre escopo drive.file', async () => {
    stubFetchSequence([{ status: 403 }])

    const erro = await capturarErro(listDatabaseFiles('token-abc', 'minhasacoe.json.gz'))

    expect(erro.status).toBe(403)
    expect(erro.message).toContain('Permissão negada pelo Google Drive.')
    expect(erro.message).toContain('drive.file')
  })

  it('429 indica cota excedida', async () => {
    stubFetchSequence([{ status: 429 }])

    const erro = await capturarErro(listDatabaseFiles('token-abc', 'minhasacoe.json.gz'))

    expect(erro.status).toBe(429)
    expect(erro.message).toBe('Cota da API do Google excedida. Tente novamente em instantes.')
  })

  it('status desconhecido mantém o código e a mensagem genérica', async () => {
    stubFetchSequence([{ status: 500 }])

    const erro = await capturarErro(listDatabaseFiles('token-abc', 'minhasacoe.json.gz'))

    expect(erro.status).toBe(500)
    expect(erro.message).toBe('Falha na API do Google Drive (HTTP 500).')
  })
})

describe('falhas de rede', () => {
  it('rejeição do fetch vira status 0 (tratado como offline pelo outbox)', async () => {
    const spy = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', spy)

    const erro = await capturarErro(readDatabaseFile('token-abc', 'arquivo-1'))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(erro.status).toBe(0)
    expect(erro.isConflict).toBe(false)
    expect(erro.message).toBe(
      'Falha de rede ao acessar o Google Drive. Verifique sua conexão.',
    )
  })

  it('timeout vira status 0 com mensagem de fila', async () => {
    const spy = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortError = new Error('Aborted')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        }),
    )
    vi.stubGlobal('fetch', spy)

    const erro = await capturarErro(readDatabaseFile('token-abc', 'arquivo-1', { timeoutMs: 10 }))

    expect(erro.status).toBe(0)
    expect(erro.message).toBe(
      'Tempo limite ao acessar o Google Drive. A alteração ficará na fila e será reenviada.',
    )
  })
})

describe('listDatabaseFiles', () => {
  it('monta a consulta com o nome escapado e mapeia os arquivos', async () => {
    const { spy, chamadas } = stubFetchSequence([
      {
        json: {
          files: [
            { id: 'arquivo-1', name: 'banco do Dré.json.gz' },
            { id: 42, name: 'inválido' },
          ],
        },
      },
    ])

    const arquivos = await listDatabaseFiles('token-abc', "banco do Dré's.json.gz")

    expect(spy).toHaveBeenCalledTimes(1)
    expect(arquivos).toEqual([
      { fileId: 'arquivo-1', name: 'banco do Dré.json.gz', etag: null },
    ])

    const url = new URL(chamadas[0]?.url ?? '')
    expect(url.origin + url.pathname).toBe(DRIVE_FILES_ENDPOINT)
    expect(url.searchParams.get('q')).toBe(
      "name = 'banco do Dré\\'s.json.gz' and mimeType = 'application/gzip' and trashed = false",
    )
    expect(url.searchParams.get('fields')).toBe('files(id,name)')
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc')
    expect(url.searchParams.get('pageSize')).toBe('10')
    expect(chamadas[0]?.headers.get('Authorization')).toBe('Bearer token-abc')
  })

  it('nome vazio devolve [] sem chamar a rede', async () => {
    const { spy } = stubFetchSequence([{ json: { files: [] } }])

    const arquivos = await listDatabaseFiles('token-abc', '   ')

    expect(arquivos).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    expect(getDriveFileRequestCount()).toBe(0)
  })
})

describe('listAllDatabaseFiles', () => {
  it('lista todos os bancos do app pelo MIME, do mais recente ao mais antigo', async () => {
    const { spy, chamadas } = stubFetchSequence([
      {
        json: {
          files: [
            { id: 'arquivo-2', name: 'Carteira B.json.gz' },
            { id: 'arquivo-1', name: 'Carteira A.json.gz' },
          ],
        },
      },
    ])

    const arquivos = await listAllDatabaseFiles('token-abc')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(arquivos.map((arquivo) => arquivo.fileId)).toEqual(['arquivo-2', 'arquivo-1'])

    const url = new URL(chamadas[0]?.url ?? '')
    expect(url.searchParams.get('q')).toBe("mimeType = 'application/gzip' and trashed = false")
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc')
  })
})

describe('contador de requisições', () => {
  it('incrementa por requisição e é zerado por resetDriveFileRequestCount', async () => {
    stubFetchSequence([
      { json: { id: 'arquivo-1', name: 'minhasacoe.json.gz' } },
      { json: { id: 'arquivo-1' } },
    ])

    await createDatabaseFile('token-abc', 'minhasacoe.json.gz', BYTES)
    expect(getDriveFileRequestCount()).toBe(2)

    resetDriveFileRequestCount()
    expect(getDriveFileRequestCount()).toBe(0)
  })
})

describe('constantes públicas', () => {
  it('exponibiliza endpoints, MIME e timeout padrão', () => {
    expect(DRIVE_FILES_ENDPOINT).toBe('https://www.googleapis.com/drive/v3/files')
    expect(DRIVE_UPLOAD_ENDPOINT).toBe('https://www.googleapis.com/upload/drive/v3/files')
    expect(DATABASE_MIME_TYPE).toBe('application/gzip')
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(20_000)
  })
})
