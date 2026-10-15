import { describe, expect, it } from 'vitest'
import { crc32, createZip } from '@/infrastructure/ods/zip'
import { OdsFormatError, readZipEntries, readZipEntry } from '@/infrastructure/ods/zipReader'
import { toArrayBuffer } from '@/infrastructure/ods/binary'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Comprime com a API nativa (mesmo caminho que os escritores reais usam). */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Monta um ZIP de uma entrada com DEFLATE (método 8), como o LibreOffice faz.
 * `tamanhosZeradosNoCabecalhoLocal` simula escritores que usam *data descriptor*
 * (flag bit 3) e deixam os tamanhos apenas no diretório central.
 */
async function zipDeflate(
  nome: string,
  conteudo: Uint8Array,
  options: { tamanhosZeradosNoCabecalhoLocal?: boolean } = {},
): Promise<Uint8Array> {
  const nomeBytes = encoder.encode(nome)
  const comprimido = await deflateRaw(conteudo)
  const crc = crc32(conteudo)
  const zerar = options.tamanhosZeradosNoCabecalhoLocal === true

  const local = new Uint8Array(30 + nomeBytes.length + comprimido.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(4, 20, true)
  localView.setUint16(6, zerar ? 0x0008 : 0, true)
  localView.setUint16(8, 8, true)
  localView.setUint32(14, zerar ? 0 : crc, true)
  localView.setUint32(18, zerar ? 0 : comprimido.length, true)
  localView.setUint32(22, zerar ? 0 : conteudo.length, true)
  localView.setUint16(26, nomeBytes.length, true)
  local.set(nomeBytes, 30)
  local.set(comprimido, 30 + nomeBytes.length)

  const central = new Uint8Array(46 + nomeBytes.length)
  const centralView = new DataView(central.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint16(4, 20, true)
  centralView.setUint16(6, 20, true)
  centralView.setUint16(10, 8, true)
  centralView.setUint32(16, crc, true)
  centralView.setUint32(20, comprimido.length, true)
  centralView.setUint32(24, conteudo.length, true)
  centralView.setUint16(28, nomeBytes.length, true)
  centralView.setUint32(42, 0, true)
  central.set(nomeBytes, 46)

  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, 1, true)
  eocdView.setUint16(10, 1, true)
  eocdView.setUint32(12, central.length, true)
  eocdView.setUint32(16, local.length, true)

  const out = new Uint8Array(local.length + central.length + eocd.length)
  out.set(local)
  out.set(central, local.length)
  out.set(eocd, local.length + central.length)
  return out
}

describe('readZipEntries', () => {
  it('lê entradas armazenadas (sem compressão)', async () => {
    const zip = createZip([
      { name: 'mimetype', data: encoder.encode('application/x') },
      { name: 'content.xml', data: encoder.encode('<oi/>') },
    ])

    const entries = await readZipEntries(zip)

    expect(entries.map((entry) => entry.name)).toEqual(['mimetype', 'content.xml'])
    expect(decoder.decode(entries[1].data)).toBe('<oi/>')
  })

  it('descomprime entradas DEFLATE (formato dos .ods reais)', async () => {
    const conteudo = encoder.encode('<office:document-content/>'.repeat(50))
    const zip = await zipDeflate('content.xml', conteudo)

    const [entry] = await readZipEntries(zip)

    expect(entry.name).toBe('content.xml')
    expect(decoder.decode(entry.data)).toBe(decoder.decode(conteudo))
  })

  it('usa os tamanhos do diretório central quando o cabeçalho local vem zerado', async () => {
    const conteudo = encoder.encode('dados comprimidos')
    const zip = await zipDeflate('content.xml', conteudo, {
      tamanhosZeradosNoCabecalhoLocal: true,
    })

    const data = await readZipEntry(zip, 'content.xml')
    if (!data) throw new Error('entrada content.xml não encontrada')

    expect(decoder.decode(data)).toBe('dados comprimidos')
  })

  it('devolve null para entrada inexistente', async () => {
    const zip = createZip([{ name: 'a', data: encoder.encode('x') }])
    expect(await readZipEntry(zip, 'nao-existe')).toBeNull()
  })

  it('lança erro amigável quando o arquivo não é um ZIP', async () => {
    await expect(readZipEntries(encoder.encode('não sou um zip'))).rejects.toBeInstanceOf(
      OdsFormatError,
    )
  })
})
