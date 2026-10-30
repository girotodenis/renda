/**
 * Utilitários binários compartilhados pelos módulos `.ods`.
 */

/**
 * Copia os bytes para um `ArrayBuffer` próprio.
 *
 * Necessário porque as APIs de `Blob`/`DecompressionStream` esperam
 * `ArrayBuffer` (e não `SharedArrayBuffer`), e porque o `Uint8Array` recebido
 * pode ser uma *view* sobre um buffer maior.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
