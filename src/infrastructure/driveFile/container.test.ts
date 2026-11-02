import { describe, expect, it } from 'vitest'
import { MAGIC } from '@/domain/criptografia'
import { criarSessao, decifrarArquivo, estaCifrado } from '@/infrastructure/cripto/envelope'
import { gunzip, gzip, isGzip } from '@/infrastructure/compression'
import { codificarBanco, decodificarBanco } from '@/infrastructure/driveFile/container'
import { DatabaseFileError, emptyDatabase } from '@/infrastructure/driveFile/format'
import type { DatabaseSheets } from '@/infrastructure/driveFile/format'
import { SHEET_HEADERS } from '@/domain/sheetsSchema'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'

/**
 * Container do arquivo do banco: o codec puro (`format.ts`) mais a cifra
 * opcional. Os testes cobrem a compatibilidade com o arquivo atual (gzip em
 * claro) e o caminho cifrado usado pelo gateway.
 */

const SENHA = 'senha de teste'
const ITERACOES_TESTE = 1000

function abasComOperacao(): DatabaseSheets {
  const sheets = emptyDatabase().sheets
  sheets.Operacoes = [
    [...SHEET_HEADERS.Operacoes],
    ['id-1', '2026-01-05', 'Compra', 'Ações', 'PETR4', 10, 30.5, 2, null, null, null, 305],
  ]
  return sheets
}

async function sessaoDeTeste() {
  return criarSessao(SENHA, { iteracoes: ITERACOES_TESTE })
}

/** O arquivo cifrado não pode ser legível sem a chave. */
function naoEhLegivelSemChave(bytes: Uint8Array): boolean {
  if (isGzip(bytes)) return false
  try {
    JSON.parse(new TextDecoder().decode(bytes))
    return false
  } catch {
    return true
  }
}

describe('codificarBanco', () => {
  it('sem sessão devolve o arquivo atual (gzip em claro)', async () => {
    const sheets = abasComOperacao()

    const bytes = await codificarBanco(sheets, 1, null)

    expect(isGzip(bytes)).toBe(true)
    expect(estaCifrado(bytes)).toBe(false)
    const texto = new TextDecoder().decode(await gunzip(bytes))
    expect(JSON.parse(texto)).toEqual({ version: 1, sheets })
  })

  it('com sessão comprime antes de cifrar', async () => {
    const sheets = abasComOperacao()
    const sessao = await sessaoDeTeste()

    const bytes = await codificarBanco(sheets, 1, sessao)

    expect(estaCifrado(bytes)).toBe(true)
    expect(new TextDecoder().decode(bytes.subarray(0, MAGIC.length))).toBe(MAGIC)
    expect(naoEhLegivelSemChave(bytes)).toBe(true)

    // O conteúdo cifrado é exatamente o gzip do JSON: comprimir veio antes.
    const claro = await decifrarArquivo(bytes, sessao.chave)
    expect(JSON.parse(new TextDecoder().decode(await gunzip(claro)))).toEqual({
      version: 1,
      sheets,
    })
  })
})

describe('decodificarBanco', () => {
  it('arquivo em claro continua legível e marca criptografado: false', async () => {
    const sheets = abasComOperacao()
    const bytes = await gzip(new TextEncoder().encode(JSON.stringify({ version: 1, sheets })))

    const { raw, criptografado } = await decodificarBanco(bytes, null)

    expect(criptografado).toBe(false)
    expect(raw).toEqual({ version: 1, sheets })
  })

  it('aceita bytes crus (ambiente sem compressão) como antes', async () => {
    const sheets = abasComOperacao()
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, sheets }))

    const { raw, criptografado } = await decodificarBanco(bytes, null)

    expect(criptografado).toBe(false)
    expect(raw).toEqual({ version: 1, sheets })
  })

  it('faz o round-trip do arquivo cifrado', async () => {
    const sheets = abasComOperacao()
    const sessao = await sessaoDeTeste()

    const bytes = await codificarBanco(sheets, 1, sessao)
    const { raw, criptografado } = await decodificarBanco(bytes, sessao.chave)

    expect(criptografado).toBe(true)
    expect(raw).toEqual({ version: 1, sheets })
    expect((raw as { sheets: DatabaseSheets }).sheets.Operacoes?.[1]?.[4] as CellValue).toBe('PETR4')
  })

  it('cifrado sem chave lança ChaveNecessariaError (sem tocar no conteúdo)', async () => {
    const sessao = await sessaoDeTeste()
    const bytes = await codificarBanco(abasComOperacao(), 1, sessao)

    await expect(decodificarBanco(bytes, null)).rejects.toMatchObject({
      name: 'ChaveNecessariaError',
    })
  })

  it('cifrado com a chave errada lança ChaveIncorretaError', async () => {
    const sessao = await sessaoDeTeste()
    const outraSessao = await criarSessao('outra senha', { iteracoes: ITERACOES_TESTE })
    const bytes = await codificarBanco(abasComOperacao(), 1, sessao)

    await expect(decodificarBanco(bytes, outraSessao.chave)).rejects.toMatchObject({
      name: 'ChaveIncorretaError',
    })
  })

  it('gzip corrompido vira DatabaseFileError de descompressão', async () => {
    const bytes = await gzip(new TextEncoder().encode(JSON.stringify(emptyDatabase())))
    // Truncar o fim remove o CRC/tamanho: o DecompressionStream falha.
    const corrompido = bytes.slice(0, Math.max(4, bytes.length - 8))

    await expect(decodificarBanco(corrompido, null)).rejects.toThrow(DatabaseFileError)
    await expect(decodificarBanco(corrompido, null)).rejects.toThrow(
      'Não foi possível descompactar o arquivo do banco de dados.',
    )
  })

  it('JSON inválido vira DatabaseFileError de formato', async () => {
    const bytes = new TextEncoder().encode('isto não é JSON')

    await expect(decodificarBanco(bytes, null)).rejects.toThrow(
      'Arquivo do banco de dados inválido: não foi possível ler o JSON.',
    )
  })
})
