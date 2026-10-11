import { afterEach, describe, expect, it, vi } from 'vitest'
import { findSpreadsheetsByName, GoogleDriveError } from '@/infrastructure/drive'

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
