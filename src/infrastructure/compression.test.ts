import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzip, gzip, isCompressionSupported, isGzip } from '@/infrastructure/compression'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Remove as APIs nativas para simular um navegador sem suporte. */
function semSuporteNativo(): void {
  vi.stubGlobal('CompressionStream', undefined)
  vi.stubGlobal('DecompressionStream', undefined)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isCompressionSupported', () => {
  it('é true quando as APIs nativas existem', () => {
    expect(isCompressionSupported()).toBe(true)
  })

  it('é false quando as APIs nativas não existem', () => {
    semSuporteNativo()
    expect(isCompressionSupported()).toBe(false)
  })
})

describe('isGzip', () => {
  it('detecta a assinatura gzip no resultado de gzip', async () => {
    const comprimido = await gzip(encoder.encode('{"a":1}'))
    expect(isGzip(comprimido)).toBe(true)
  })

  it('é false em bytes crus', () => {
    expect(isGzip(encoder.encode('{"a":1}'))).toBe(false)
    expect(isGzip(new Uint8Array(0))).toBe(false)
  })
})

describe('gzip + gunzip', () => {
  it('faz round-trip preservando os bytes originais (UTF-8 com acentos)', async () => {
    const original = encoder.encode(JSON.stringify({ nome: 'João', descrição: 'Ação/Órgão' }))

    const comprimido = await gzip(original)
    expect(comprimido).not.toEqual(original)

    const descomprimido = await gunzip(comprimido)
    expect(descomprimido).toEqual(original)
    expect(decoder.decode(descomprimido)).toContain('João')
  })

  it('reduz o tamanho de um conteúdo repetitivo', async () => {
    const repetitivo = encoder.encode(JSON.stringify({ valores: Array(500).fill('renda-fixa') }))

    const comprimido = await gzip(repetitivo)
    expect(comprimido.length).toBeLessThan(repetitivo.length)
  })

  it('gunzip devolve os mesmos bytes quando a entrada não é gzip', async () => {
    const cru = encoder.encode('{"sem":"compressão"}')
    expect(await gunzip(cru)).toEqual(cru)
  })
})

describe('fallback sem APIs nativas', () => {
  it('gzip devolve os mesmos bytes e gunzip também', async () => {
    semSuporteNativo()
    const original = encoder.encode('{"modo":"fallback"}')

    const comprimido = await gzip(original)
    expect(comprimido).toEqual(original)
    expect(isGzip(comprimido)).toBe(false)

    const descomprimido = await gunzip(comprimido)
    expect(descomprimido).toEqual(original)
  })
})
