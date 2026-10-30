/**
 * Escritor mínimo de arquivos ZIP — formato contêiner do OpenDocument (`.ods`).
 *
 * O `.ods` é um ZIP com `mimetype`, `META-INF/manifest.xml`, `content.xml`,
 * `styles.xml` e `meta.xml`. Em vez de trazer uma dependência de compressão
 * (o projeto é offline-first e não tem bundlers de ZIP), este módulo escreve
 * entradas **armazenadas** (método 0, sem deflate):
 *
 * - gera arquivos maiores que um ZIP comprimido (irrelevante: planilhas de
 *   carteira são pequenas);
 * - evita implementar/baixar DEFLATE;
 * - atende à ODF, que exige apenas que `mimetype` seja a **primeira** entrada e
 *   **não comprimida**.
 */

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const END_OF_CENTRAL_SIZE = 22

/** CRC-32 (polinômio 0xEDB88320), exigido nos cabeçalhos do ZIP. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/** Calcula o CRC-32 de um buffer (mesmo algoritmo do `zlib.crc32`). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Entrada do ZIP (o nome usa `/` como separador, sempre UTF-8). */
export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** Opções de escrita do ZIP. */
export interface ZipOptions {
  /**
   * Data/hora gravada nos cabeçalhos. `null` (padrão) usa 1980-01-01 00:00,
   * tornando a saída determinística (útil em testes).
   */
  modifiedAt?: Date | null
}

function writeUInt16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true)
}

function writeUInt32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

/** Converte uma data no par (hora, data) do formato MS-DOS usado pelo ZIP. */
function dosDateTime(date: Date | null): { time: number; date: number } {
  if (!date) {
    // ZIP não representa datas anteriores a 1980: (1980-1980)<<9 | 1<<5 | 1.
    return { time: 0, date: (1 << 5) | 1 }
  }
  const year = Math.max(date.getFullYear(), 1980)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * Monta um ZIP com todas as entradas armazenadas (sem compressão), na ordem
 * informada — a primeira deve ser o `mimetype` nos arquivos ODF.
 */
export function createZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Uint8Array {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(options.modifiedAt ?? null)
  // Flag 0x0800 declara os nomes como UTF-8.
  const FLAG_UTF8 = 0x0800

  const prepared = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
    offset: 0,
  }))

  const localSize = prepared.reduce(
    (total, entry) => total + LOCAL_HEADER_SIZE + entry.name.length + entry.data.length,
    0,
  )
  const centralSize = prepared.reduce(
    (total, entry) => total + CENTRAL_HEADER_SIZE + entry.name.length,
    0,
  )

  const out = new Uint8Array(localSize + centralSize + END_OF_CENTRAL_SIZE)
  const view = new DataView(out.buffer)

  let offset = 0
  for (const entry of prepared) {
    entry.offset = offset
    writeUInt32(view, offset, 0x04034b50)
    writeUInt16(view, offset + 4, 20) // versão mínima
    writeUInt16(view, offset + 6, FLAG_UTF8)
    writeUInt16(view, offset + 8, 0) // método: armazenado
    writeUInt16(view, offset + 10, time)
    writeUInt16(view, offset + 12, date)
    writeUInt32(view, offset + 14, entry.crc)
    writeUInt32(view, offset + 18, entry.data.length)
    writeUInt32(view, offset + 22, entry.data.length)
    writeUInt16(view, offset + 26, entry.name.length)
    writeUInt16(view, offset + 28, 0) // extra
    out.set(entry.name, offset + LOCAL_HEADER_SIZE)
    out.set(entry.data, offset + LOCAL_HEADER_SIZE + entry.name.length)
    offset += LOCAL_HEADER_SIZE + entry.name.length + entry.data.length
  }

  const centralStart = offset
  for (const entry of prepared) {
    writeUInt32(view, offset, 0x02014b50)
    writeUInt16(view, offset + 4, 20) // versão de criação
    writeUInt16(view, offset + 6, 20) // versão mínima
    writeUInt16(view, offset + 8, FLAG_UTF8)
    writeUInt16(view, offset + 10, 0)
    writeUInt16(view, offset + 12, time)
    writeUInt16(view, offset + 14, date)
    writeUInt32(view, offset + 16, entry.crc)
    writeUInt32(view, offset + 20, entry.data.length)
    writeUInt32(view, offset + 24, entry.data.length)
    writeUInt16(view, offset + 28, entry.name.length)
    writeUInt16(view, offset + 30, 0) // extra
    writeUInt16(view, offset + 32, 0) // comentário
    writeUInt16(view, offset + 34, 0) // disco inicial
    writeUInt16(view, offset + 36, 0) // atributos internos
    writeUInt32(view, offset + 38, 0) // atributos externos
    writeUInt32(view, offset + 42, entry.offset)
    out.set(entry.name, offset + CENTRAL_HEADER_SIZE)
    offset += CENTRAL_HEADER_SIZE + entry.name.length
  }

  writeUInt32(view, offset, 0x06054b50)
  writeUInt16(view, offset + 4, 0)
  writeUInt16(view, offset + 6, 0)
  writeUInt16(view, offset + 8, prepared.length)
  writeUInt16(view, offset + 10, prepared.length)
  writeUInt32(view, offset + 12, offset - centralStart)
  writeUInt32(view, offset + 16, centralStart)
  writeUInt16(view, offset + 20, 0)

  return out
}
