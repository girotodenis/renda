import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureAppFolder,
  findAppFolder,
  findSpreadsheetsByName,
  listAppSpreadsheets,
  GoogleDriveError,
  moveFileToFolder,
} from '@/infrastructure/drive'

/**
 * Testes da busca de planilhas por título no Drive (detecção de duplicidade
 * antes de criar a planilha padrão). A rede é substituída por um stub de
 * `fetch` para manter os testes puros (ambiente `node`).
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

/** Instala um stub de `fetch` e devolve as URLs chamadas (na ordem). */
function stubFetch(status: number, body: unknown) {
  const chamadas: string[] = []
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    chamadas.push(String(input))
    return jsonResponse(status, body)
  })
  vi.stubGlobal('fetch', spy)
  return { spy, chamadas }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub de `fetch` que devolve respostas em sequência e registra URLs/métodos. */
function stubFetchSequence(responses: unknown[]) {
  const chamadas: string[] = []
  const metodos: string[] = []
  let index = 0
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push(String(input))
    metodos.push((init?.method ?? 'GET').toUpperCase())
    const body = responses[index] ?? {}
    index += 1
    return jsonResponse(200, body)
  })
  vi.stubGlobal('fetch', spy)
  return { spy, chamadas, metodos }
}

describe('findSpreadsheetsByName', () => {
  it('consulta o Drive pelo título exato e mapeia os arquivos encontrados', async () => {
    const { spy, chamadas } = stubFetch(200, {
      files: [
        { id: 'abc', name: 'Minhas Ações — Carteira' },
        { id: 'def', name: 'Minhas Ações — Carteira' },
        { id: 123, name: 'inválido' },
      ],
    })

    const encontradas = await findSpreadsheetsByName('token', 'Minhas Ações — Carteira')

    expect(encontradas).toEqual([
      { spreadsheetId: 'abc', title: 'Minhas Ações — Carteira' },
      { spreadsheetId: 'def', title: 'Minhas Ações — Carteira' },
    ])
    expect(spy).toHaveBeenCalledTimes(1)

    const url = new URL(chamadas[0] ?? '')
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(url.searchParams.get('q')).toContain("name = 'Minhas Ações — Carteira'")
    expect(url.searchParams.get('q')).toContain(
      "mimeType = 'application/vnd.google-apps.spreadsheet'",
    )
    expect(url.searchParams.get('fields')).toBe('files(id,name)')
  })

  it('escapa apóstrofos do título na consulta', async () => {
    const { chamadas } = stubFetch(200, { files: [] })

    await findSpreadsheetsByName('token', "Carteira d'água")

    const url = new URL(chamadas[0] ?? '')
    expect(url.searchParams.get('q')).toContain("name = 'Carteira d\\'água'")
  })

  it('não consulta a API quando o título é vazio', async () => {
    const { spy } = stubFetch(200, { files: [] })

    expect(await findSpreadsheetsByName('token', '   ')).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('lança GoogleDriveError com mensagem amigável em resposta de erro', async () => {
    stubFetch(403, {})

    const erro = await findSpreadsheetsByName('token', 'Carteira').catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(GoogleDriveError)
    expect((erro as Error).message).toContain('Permissão negada')
  })

  it('tolera resposta sem a lista de arquivos', async () => {
    stubFetch(200, {})

    expect(await findSpreadsheetsByName('token', 'Carteira')).toEqual([])
  })
})

describe('listAppSpreadsheets', () => {
  it('lista as planilhas visíveis para o app, com a data de modificação', async () => {
    const { spy, chamadas } = stubFetch(200, {
      files: [
        { id: 'abc', name: 'Carteira A', modifiedTime: '2026-02-01T10:00:00Z' },
        { id: 42, name: 'inválido' },
      ],
    })

    const planilhas = await listAppSpreadsheets('token')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(planilhas).toEqual([
      { spreadsheetId: 'abc', title: 'Carteira A', modificadaEm: '2026-02-01T10:00:00Z' },
    ])

    const url = new URL(chamadas[0] ?? '')
    expect(url.searchParams.get('q')).toBe(
      "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    )
    expect(url.searchParams.get('fields')).toBe('files(id,name,modifiedTime)')
  })

  it('lança GoogleDriveError em resposta de erro', async () => {
    stubFetch(403, {})

    const erro = await listAppSpreadsheets('token').catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(GoogleDriveError)
  })
})

describe('findAppFolder', () => {
  it('devolve o id da pasta quando ela existe', async () => {
    stubFetchSequence([{ files: [{ id: 'pasta-1' }] }])

    expect(await findAppFolder('token')).toBe('pasta-1')
  })

  it('devolve null (sem criar nada) quando a pasta não existe', async () => {
    const { spy, metodos } = stubFetchSequence([{ files: [] }])

    expect(await findAppFolder('token')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(metodos).toEqual(['GET'])
  })
})

describe('ensureAppFolder', () => {
  it('reaproveita a pasta padrão existente do app', async () => {
    const { spy, chamadas, metodos } = stubFetchSequence([
      { files: [{ id: 'pasta-1', name: 'minhasacoe_app' }] },
    ])

    const id = await ensureAppFolder('token')

    expect(id).toBe('pasta-1')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(metodos).toEqual(['GET'])

    const url = new URL(chamadas[0] ?? '')
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(url.searchParams.get('q')).toContain("name = 'minhasacoe_app'")
    expect(url.searchParams.get('q')).toContain("mimeType = 'application/vnd.google-apps.folder'")
  })

  it('cria a pasta quando ela ainda não existe', async () => {
    const { chamadas, metodos } = stubFetchSequence([{ files: [] }, { id: 'pasta-nova' }])

    const id = await ensureAppFolder('token')

    expect(id).toBe('pasta-nova')
    expect(metodos).toEqual(['GET', 'POST'])
    expect(new URL(chamadas[1] ?? '').searchParams.get('fields')).toBe('id')
  })

  it('lança GoogleDriveError quando a criação da pasta falha', async () => {
    stubFetch(403, {})

    await expect(ensureAppFolder('token')).rejects.toBeInstanceOf(GoogleDriveError)
  })
})

describe('moveFileToFolder', () => {
  it('adiciona a pasta e remove o pai anterior do arquivo', async () => {
    const { chamadas, metodos } = stubFetchSequence([{ parents: ['root'] }, {}])

    await moveFileToFolder('token', 'planilha-1', 'pasta-1')

    expect(metodos).toEqual(['GET', 'PATCH'])

    const patch = new URL(chamadas[1] ?? '')
    expect(patch.pathname).toBe('/drive/v3/files/planilha-1')
    expect(patch.searchParams.get('addParents')).toBe('pasta-1')
    expect(patch.searchParams.get('removeParents')).toBe('root')
  })

  it('não remove pais quando o arquivo já está na pasta', async () => {
    const { chamadas } = stubFetchSequence([{ parents: ['pasta-1'] }, {}])

    await moveFileToFolder('token', 'planilha-1', 'pasta-1')

    expect(new URL(chamadas[1] ?? '').searchParams.has('removeParents')).toBe(false)
  })

  it('lança GoogleDriveError em falha da API', async () => {
    stubFetch(403, {})

    await expect(moveFileToFolder('token', 'planilha-1', 'pasta-1')).rejects.toBeInstanceOf(
      GoogleDriveError,
    )
  })
})
