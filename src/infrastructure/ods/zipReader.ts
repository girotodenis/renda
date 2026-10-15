import type { ZipEntry } from '@/infrastructure/ods/zip'
import { toArrayBuffer } from '@/infrastructure/ods/binary'

/**
 * Leitor mínimo de arquivos ZIP (formato contêiner do `.ods`).
 *
 * Um `.ods` real (LibreOffice, Google Planilhas, Excel) normalmente vem com as
 * entradas **comprimidas em DEFLATE**, então não basta "fatiar" o arquivo: é
 * preciso descomprimir. Em vez de embarcar uma biblioteca de ZIP/DEFLATE, usa-se
 * `DecompressionStream('deflate-raw')`, disponível nativamente nos navegadores
 * atuais e no Node — zero dependências e sem código de inflate para manter.
 *
 * O diretório central é a fonte de verdade dos tamanhos: alguns escritores
 * gravam zeros no cabeçalho local e usam *data descriptor* (flag bit 3), o que
 * quebraria uma leitura baseada apenas no cabeçalho local.
 */

const CENTRAL_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_SIGNATURE = 0x06054b50

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const END_OF_CENTRAL_SIZE = 22

/** Maior comentário possível no EOCD (`uint16`). */
const MAX_COMMENT_SIZE = 0xffff

/** Limite de entradas (proteção contra arquivos malformados). */
const MAX_ENTRIES = 4096

const METODO_ARMAZENADO = 0
const METODO_DEFLATE = 8

const decoder = new TextDecoder()

/** Erro de leitura de um arquivo ZIP/`.ods` (mensagem amigável em pt-BR). */
export class OdsFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OdsFormatError'
  }
}

/** Localiza o End of Central Directory varrendo do fim para o começo. */
function findEndOfCentralDirectory(view: DataView): number {
  const lastOffset = view.byteLength - END_OF_CENTRAL_SIZE
  const firstOffset = Math.max(0, lastOffset - MAX_COMMENT_SIZE)
  for (let offset = lastOffset; offset >= firstOffset; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_SIGNATURE) return offset
  }
  return -1
}

/** Descomprime um bloco DEFLATE cru usando a API nativa do ambiente. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new OdsFormatError(
      'Este navegador não consegue descomprimir arquivos .ods. Atualize o navegador e tente novamente.',
    )
  }

  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function entryData(
  bytes: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  method: number,
  compressedSize: number,
): Promise<Uint8Array> {
  // Os comprimentos de nome/extra do cabeçalho local podem diferir dos do
  // diretório central: é preciso lê-los daqui para achar o início dos dados.
  const nameLength = view.getUint16(localHeaderOffset + 26, true)
  const extraLength = view.getUint16(localHeaderOffset + 28, true)
  const start = localHeaderOffset + LOCAL_HEADER_SIZE + nameLength + extraLength
  const data = bytes.subarray(start, start + compressedSize)

  if (method === METODO_ARMAZENADO) return Promise.resolve(data.slice())
  if (method === METODO_DEFLATE) return inflateRaw(data)
  return Promise.reject(
    new OdsFormatError(`Método de compressão não suportado no arquivo .ods (${method}).`),
  )
}

/** Lê todas as entradas do ZIP (nome + conteúdo já descomprimido). */
export async function readZipEntries(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const endOffset = findEndOfCentralDirectory(view)
  if (endOffset < 0) {
    throw new OdsFormatError('O arquivo selecionado não é um pacote .ods válido (ZIP não encontrado).')
  }

  const total = Math.min(view.getUint16(endOffset + 10, true), MAX_ENTRIES)
  let offset = view.getUint32(endOffset + 16, true)
  const entries: ZipEntry[] = []

  for (let index = 0; index < total; index += 1) {
    if (offset + CENTRAL_HEADER_SIZE > view.byteLength) break
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break

    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)

    const nameStart = offset + CENTRAL_HEADER_SIZE
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))

    entries.push({
      name,
      data: await entryData(bytes, view, localHeaderOffset, method, compressedSize),
    })

    offset = nameStart + nameLength + extraLength + commentLength
  }

  return entries
}

/** Lê uma entrada específica do ZIP (`null` quando não existe). */
export async function readZipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const entries = await readZipEntries(bytes)
  return entries.find((entry) => entry.name === name)?.data ?? null
}
