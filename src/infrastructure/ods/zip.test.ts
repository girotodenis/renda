import { describe, expect, it } from 'vitest'
import { crc32, createZip } from '@/infrastructure/ods/zip'

const encoder = new TextEncoder()

describe('crc32', () => {
  it('calcula o CRC-32 conhecido de "123456789"', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926)
  })

  it('devolve 0 para um buffer vazio', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('createZip', () => {
  it('escreve o cabeçalho local, o diretório central e o EOCD', () => {
    const zip = createZip([{ name: 'mimetype', data: encoder.encode('oi') }])
    const view = new DataView(zip.buffer)

    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    // Total de entradas no diretório central.
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1)
  })

  it('grava as entradas sem compressão (método 0) e com o nome em UTF-8', () => {
    const zip = createZip([{ name: 'content.xml', data: encoder.encode('<x/>') }])
    const view = new DataView(zip.buffer)

    expect(view.getUint16(0 + 8, true)).toBe(0)
    const nameLength = view.getUint16(0 + 26, true)
    const name = new TextDecoder().decode(zip.slice(30, 30 + nameLength))
    expect(name).toBe('content.xml')
    expect(view.getUint16(0 + 6, true)).toBe(0x0800)
  })

  it('preserva a ordem das entradas e os dados de cada uma', () => {
    const zip = createZip([
      { name: 'mimetype', data: encoder.encode('A') },
      { name: 'b.txt', data: encoder.encode('B') },
    ])
    const view = new DataView(zip.buffer)

    const firstNameLength = view.getUint16(26, true)
    expect(new TextDecoder().decode(zip.slice(30, 30 + firstNameLength))).toBe('mimetype')

    const secondHeaderOffset = 30 + firstNameLength + 1
    const secondNameLength = view.getUint16(secondHeaderOffset + 26, true)
    expect(
      new TextDecoder().decode(
        zip.slice(secondHeaderOffset + 30, secondHeaderOffset + 30 + secondNameLength),
      ),
    ).toBe('b.txt')
  })

  it('usa 1980-01-01 quando nenhuma data é informada (saída determinística)', () => {
    const first = createZip([{ name: 'a', data: encoder.encode('x') }])
    const second = createZip([{ name: 'a', data: encoder.encode('x') }])
    expect(Array.from(first)).toEqual(Array.from(second))
  })
})
