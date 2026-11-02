/**
 * Primitivas de criptografia sobre Web Crypto (`PLANO_CRIPTOGRAFIA.md` §3.1).
 *
 * AES-256-GCM e PBKDF2-HMAC-SHA256 são nativos do navegador (e do Node 20), o
 * que mantém a regra de zero dependências novas. A chave derivada é
 * **não-extraível**: mesmo um bug de serialização não consegue exportá-la.
 *
 * Web Crypto só existe em contexto seguro (HTTPS ou `localhost`); quem chama
 * deve consultar `isCriptografiaSuportada()` antes.
 */

import { IV_BYTES } from '@/domain/criptografia'

const ALGORITMO_KDF = 'PBKDF2'
const ALGORITMO_CIFRA = 'AES-GCM'
const TAMANHO_CHAVE_BITS = 256
const TAMANHO_TAG_BITS = 128

/** `true` quando há Web Crypto utilizável (contexto seguro com `subtle`). */
export function isCriptografiaSuportada(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  )
}

/** Bytes aleatórios do CSPRNG do sistema (IV e salt). */
export function gerarBytesAleatorios(n: number): Uint8Array {
  if (!isCriptografiaSuportada()) {
    throw new Error('Web Crypto indisponível: a criptografia exige HTTPS ou localhost.')
  }
  return crypto.getRandomValues(new Uint8Array(n))
}

/** Deriva a chave AES-256 a partir da senha (PBKDF2-HMAC-SHA256). */
export async function derivarChave(
  senha: string,
  salt: Uint8Array,
  iteracoes: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    bufferDe(new TextEncoder().encode(senha)),
    ALGORITMO_KDF,
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: ALGORITMO_KDF, hash: 'SHA-256', salt: bufferDe(salt), iterations: iteracoes },
    material,
    { name: ALGORITMO_CIFRA, length: TAMANHO_CHAVE_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Cifra com AES-256-GCM. A tag de 128 bits já vai anexada ao resultado (padrão
 * do WebCrypto), então não há campo separado no envelope.
 */
export async function cifrarBytes(
  chave: CryptoKey,
  dados: Uint8Array,
  aad: Uint8Array,
  iv: Uint8Array = gerarBytesAleatorios(IV_BYTES),
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITMO_CIFRA,
      iv: bufferDe(iv),
      additionalData: bufferDe(aad),
      tagLength: TAMANHO_TAG_BITS,
    },
    chave,
    bufferDe(dados),
  )

  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/** Decifra com AES-256-GCM; lança quando a tag (ou o AAD) não confere. */
export async function decifrarBytes(
  chave: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const claro = await crypto.subtle.decrypt(
    {
      name: ALGORITMO_CIFRA,
      iv: bufferDe(iv),
      additionalData: bufferDe(aad),
      tagLength: TAMANHO_TAG_BITS,
    },
    chave,
    bufferDe(ciphertext),
  )

  return new Uint8Array(claro)
}

/** Cópia em `ArrayBuffer` exato — evita depender da visão de buffer recebida. */
function bufferDe(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
