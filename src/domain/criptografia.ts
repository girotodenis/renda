/**
 * Formato do arquivo cifrado e utilitários puros do envelope (`PLANO_CRIPTOGRAFIA.md` §3).
 *
 * Este módulo não usa Web Crypto nem qualquer API de criptografia: só descreve
 * o cabeçalho em claro, converte Base64 e detecta o magic. Assim o formato pode
 * ser testado no Node sem `subtle` e o mesmo código roda no navegador.
 *
 * O cabeçalho fica **em claro** de propósito: é ele que permite saber se o
 * arquivo está cifrado (e com quais parâmetros derivar a chave) antes de ter a
 * chave. A autenticidade dele é garantida pelo AAD do AES-GCM, não por sigilo.
 */

/** Assinatura ASCII no início do arquivo cifrado (16 bytes). */
export const MAGIC = 'MINHASACOES-ENC1'

/** Versão do formato do envelope; presente no cabeçalho como `v`. */
export const CRIPTO_VERSAO = 1

/** Nome da derivação de chave registrado no cabeçalho. */
export const KDF_NOME = 'PBKDF2-SHA256'

/** Iterações de PBKDF2 em produção. Custa ~0,5 s por derivação, de propósito. */
export const KDF_ITERACOES = 600_000

/**
 * Faixa aceita ao LER um cabeçalho. O piso evita aceitar arquivos que anunciam
 * uma derivação falsamente barata; o teto evita um cabeçalho adulterado travar
 * a derivação. Testes usam 1000 iterações; produção usa `KDF_ITERACOES`.
 */
export const KDF_ITERACOES_MINIMAS = 1_000
export const KDF_ITERACOES_MAXIMAS = 10_000_000

/** Nome da cifra registrado no cabeçalho. */
export const CIFRA_NOME = 'AES-256-GCM'

/** Tamanho do salt de PBKDF2 em bytes. */
export const SALT_BYTES = 16

/** Tamanho do IV do AES-GCM em bytes (recomendação de 96 bits). */
export const IV_BYTES = 12

const MAGIC_BYTES = new Uint8Array(Array.from(MAGIC, (caractere) => caractere.charCodeAt(0)))
const BASE64_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Cabeçalho interpretado. `json` é o texto exato lido do arquivo (vira AAD). */
export interface CabecalhoCripto {
  versao: number
  iteracoes: number
  salt: Uint8Array
  iv: Uint8Array
  /** Texto original do cabeçalho — o AAD precisa dos bytes reais, não de uma remontagem. */
  json: string
}

/** Campos aceitos por `montarCabecalho`. */
export interface ParametrosCabecalho {
  /** Default: `CRIPTO_VERSAO`. */
  versao?: number
  iteracoes: number
  salt: Uint8Array
  iv: Uint8Array
}

/** Senha em branco (não há mínimo de tamanho). */
export class SenhaVaziaError extends Error {
  constructor(
    mensagem = 'Informe uma senha (não há mínimo de tamanho, mas não pode ficar em branco).',
  ) {
    super(mensagem)
    this.name = 'SenhaVaziaError'
  }
}

/** Cabeçalho ausente, malformado ou com parâmetros não suportados. */
export class CriptografiaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'CriptografiaInvalidaError'
  }
}

/** Bytes do magic, sem o `\n` que separa o cabeçalho. */
export function magicBytes(): Uint8Array {
  return MAGIC_BYTES.slice()
}

/** `true` quando `bytes` começa com o magic do container cifrado. */
export function temMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_BYTES.length) return false
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (bytes[i] !== MAGIC_BYTES[i]) return false
  }
  return true
}

/**
 * Estado de criptografia do arquivo do Drive.
 *
 * A detecção é **só** pelo magic: "não é gzip" nunca significa "cifrado" — o
 * fallback sem `CompressionStream` grava JSON puro, que também não é gzip.
 */
export function criptografiaDoArquivo(bytes: Uint8Array): 'nenhuma' | 'total' {
  return temMagic(bytes) ? 'total' : 'nenhuma'
}

/**
 * Valida a senha e devolve o texto **como veio**: espaços nas pontas podem ser
 * parte da senha do usuário, então nada de `trim` destrutivo.
 */
export function validarChave(senha: string): string {
  if (typeof senha !== 'string' || senha.trim().length === 0) throw new SenhaVaziaError()
  return senha
}

/** Serializa o cabeçalho no formato canônico do plano (sem espaços). */
export function montarCabecalho({
  versao = CRIPTO_VERSAO,
  iteracoes,
  salt,
  iv,
}: ParametrosCabecalho): string {
  validarVersao(versao)
  validarIteracoes(iteracoes)
  validarTamanho(salt, SALT_BYTES, 'salt')
  validarTamanho(iv, IV_BYTES, 'IV')

  return JSON.stringify({
    v: versao,
    kdf: { n: KDF_NOME, i: iteracoes, s: bytesParaBase64(salt) },
    cifra: { n: CIFRA_NOME, iv: bytesParaBase64(iv) },
  })
}

/**
 * Lê e valida um cabeçalho. Qualquer desvio (versão, algoritmo, tamanho,
 * Base64, iterações fora da faixa) vira `CriptografiaInvalidaError` com uma
 * mensagem que diz o que está errado.
 */
export function parseCabecalho(json: string): CabecalhoCripto {
  let bruto: unknown
  try {
    bruto = JSON.parse(json)
  } catch {
    throw new CriptografiaInvalidaError('Cabeçalho de criptografia inválido: não é um JSON válido.')
  }

  const raiz = comoObjeto(bruto, 'cabeçalho')
  const versao = raiz.v
  if (typeof versao !== 'number' || !Number.isInteger(versao)) {
    throw new CriptografiaInvalidaError(
      'Cabeçalho de criptografia inválido: versão ausente ou inválida.',
    )
  }
  validarVersao(versao)

  const kdf = comoObjeto(raiz.kdf, 'kdf')
  if (kdf.n !== KDF_NOME) {
    throw new CriptografiaInvalidaError(
      `Cabeçalho de criptografia inválido: derivação "${String(kdf.n)}" não suportada.`,
    )
  }
  const iteracoes = kdf.i
  if (typeof iteracoes !== 'number') {
    throw new CriptografiaInvalidaError(
      'Cabeçalho de criptografia inválido: número de iterações ausente.',
    )
  }
  validarIteracoes(iteracoes)

  const salt = base64DoCabecalho(kdf.s, 'salt')
  validarTamanho(salt, SALT_BYTES, 'salt')

  const cifra = comoObjeto(raiz.cifra, 'cifra')
  if (cifra.n !== CIFRA_NOME) {
    throw new CriptografiaInvalidaError(
      `Cabeçalho de criptografia inválido: cifra "${String(cifra.n)}" não suportada.`,
    )
  }
  const iv = base64DoCabecalho(cifra.iv, 'IV')
  validarTamanho(iv, IV_BYTES, 'IV')

  return { versao, iteracoes, salt, iv, json }
}

/** Base64 padrão (RFC 4648) de bytes — sem `btoa`/`Buffer`, igual no Node e no navegador. */
export function bytesParaBase64(bytes: Uint8Array): string {
  let saida = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null

    saida += BASE64_ALFABETO[b0 >> 2]
    saida += BASE64_ALFABETO[((b0 & 0x03) << 4) | (b1 === null ? 0 : b1 >> 4)]
    saida += b1 === null ? '=' : BASE64_ALFABETO[((b1 & 0x0f) << 2) | (b2 === null ? 0 : b2 >> 6)]
    saida += b2 === null ? '=' : BASE64_ALFABETO[b2 & 0x3f]
  }
  return saida
}

/** Inverso de `bytesParaBase64`; rejeita tamanho, alfabeto e padding inválidos. */
export function base64ParaBytes(texto: string): Uint8Array {
  if (texto.length % 4 !== 0) {
    throw new CriptografiaInvalidaError('Base64 inválido: o tamanho não é múltiplo de 4.')
  }

  const semPadding = texto.replace(/=+$/, '')
  if (texto.length - semPadding.length > 2) {
    throw new CriptografiaInvalidaError('Base64 inválido: padding excessivo.')
  }
  if (semPadding.length % 4 === 1) {
    throw new CriptografiaInvalidaError('Base64 inválido: quantidade de caracteres inconsistente.')
  }

  const bytes: number[] = []
  let acumulador = 0
  let bits = 0
  for (const caractere of semPadding) {
    acumulador = ((acumulador << 6) | valorBase64(caractere)) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acumulador >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

function comoObjeto(valor: unknown, campo: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new CriptografiaInvalidaError(`Cabeçalho de criptografia inválido: "${campo}" ausente.`)
  }
  return valor as Record<string, unknown>
}

function base64DoCabecalho(valor: unknown, campo: string): Uint8Array {
  if (typeof valor !== 'string') {
    throw new CriptografiaInvalidaError(`Cabeçalho de criptografia inválido: "${campo}" ausente.`)
  }
  try {
    return base64ParaBytes(valor)
  } catch {
    throw new CriptografiaInvalidaError(
      `Cabeçalho de criptografia inválido: "${campo}" não está em Base64.`,
    )
  }
}

function validarVersao(versao: number): void {
  if (versao !== CRIPTO_VERSAO) {
    throw new CriptografiaInvalidaError(`Versão de criptografia não suportada: ${versao}.`)
  }
}

function validarIteracoes(iteracoes: number): void {
  if (
    !Number.isInteger(iteracoes) ||
    iteracoes < KDF_ITERACOES_MINIMAS ||
    iteracoes > KDF_ITERACOES_MAXIMAS
  ) {
    throw new CriptografiaInvalidaError(
      `Cabeçalho de criptografia inválido: iterações fora da faixa aceita (${KDF_ITERACOES_MINIMAS}–${KDF_ITERACOES_MAXIMAS}).`,
    )
  }
}

function validarTamanho(bytes: Uint8Array, esperado: number, campo: string): void {
  if (bytes.length !== esperado) {
    throw new CriptografiaInvalidaError(
      `Cabeçalho de criptografia inválido: "${campo}" deveria ter ${esperado} bytes.`,
    )
  }
}

function valorBase64(caractere: string): number {
  const indice = BASE64_ALFABETO.indexOf(caractere)
  if (indice < 0) {
    throw new CriptografiaInvalidaError('Base64 inválido: caractere fora do alfabeto.')
  }
  return indice
}
