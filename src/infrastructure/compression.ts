import { toArrayBuffer } from '@/infrastructure/ods/binary'

/**
 * Compressão gzip do arquivo JSON no Drive (`PLANO_DRIVE_JSON.md`).
 *
 * O arquivo remoto é um único JSON comprimido com gzip. Em vez de embarcar uma
 * biblioteca de compressão, usa-se `CompressionStream`/`DecompressionStream`
 * nativos — zero dependências e nenhum codec para manter.
 *
 * Quando o ambiente não expõe essas APIs (navegadores antigos), o módulo degrada
 * para "sem compressão": devolve os bytes como estão. `gunzip` também aceita
 * bytes crus, então arquivos gravados no modo fallback continuam legíveis.
 */

const GZIP_MAGIC_FIRST = 0x1f
const GZIP_MAGIC_SECOND = 0x8b

/** `true` quando as APIs nativas de compressão/descompressão existem. */
export function isCompressionSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

/** `true` quando os bytes começam com a assinatura gzip (`0x1f 0x8b`). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_FIRST && bytes[1] === GZIP_MAGIC_SECOND
}

/** Comprime os bytes em gzip (ou devolve uma cópia quando não há suporte). */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isCompressionSupported()) return bytes.slice()

  const stream = new Blob([toArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Descomprime bytes gzip; bytes já crus são devolvidos sem alteração. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isCompressionSupported() || !isGzip(bytes)) return bytes.slice()

  const stream = new Blob([toArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}
