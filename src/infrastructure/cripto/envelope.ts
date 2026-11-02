/**
 * Envelope do banco cifrado no Drive (`PLANO_CRIPTOGRAFIA.md` §3.2).
 *
 * Layout:
 *
 * ```
 * 0   17 bytes: "MINHASACOES-ENC1" + "\n"
 * 17  cabeçalho JSON UTF-8 + "\n"
 * ... ciphertext (AES-256-GCM de gzip(JSON))
 * ```
 *
 * O cabeçalho fica fora do ciphertext para o app poder detectar o estado **sem**
 * a chave. Em troca, ele vai como AAD: trocar salt, iterações ou IV invalida a
 * tag, então a decisão de "arquivo está cifrado" não pode ser forjada.
 *
 * O IV é novo a cada gravação (nunca reaproveitar IV em GCM). A sessão guarda
 * salt e iterações justamente para recifrar mantendo o mesmo cabeçalho.
 */

import {
  CriptografiaInvalidaError,
  IV_BYTES,
  KDF_ITERACOES,
  MAGIC,
  SALT_BYTES,
  criptografiaDoArquivo,
  magicBytes,
  montarCabecalho,
  parseCabecalho,
  temMagic,
  validarChave,
} from '@/domain/criptografia'
import type { CabecalhoCripto } from '@/domain/criptografia'
import {
  cifrarBytes,
  decifrarBytes,
  derivarChave,
  gerarBytesAleatorios,
} from '@/infrastructure/cripto/webCrypto'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const NOVA_LINHA = 0x0a

/** Chave derivada + parâmetros do cabeçalho, mantidos só em memória. */
export interface SessaoCripto {
  chave: CryptoKey
  salt: Uint8Array
  iteracoes: number
}

/** A tag não validou: senha errada ou arquivo adulterado. */
export class ChaveIncorretaError extends Error {
  constructor(mensagem = 'Chave incorreta. Verifique e tente novamente.') {
    super(mensagem)
    this.name = 'ChaveIncorretaError'
  }
}

/** O banco está cifrado e a sessão ainda não tem chave (usado na Fase 3). */
export class ChaveNecessariaError extends Error {
  constructor(mensagem = 'Este banco está criptografado. Informe a chave para continuar.') {
    super(mensagem)
    this.name = 'ChaveNecessariaError'
  }
}

/** `true` quando os bytes são o container cifrado (detecção só pelo magic). */
export function estaCifrado(bytes: Uint8Array): boolean {
  return criptografiaDoArquivo(bytes) === 'total'
}

/** Lê o cabeçalho do arquivo cifrado; lança `CriptografiaInvalidaError` se o magic faltar. */
export function lerCabecalho(bytes: Uint8Array): CabecalhoCripto {
  return localizarCabecalho(bytes).cabecalho
}

/** Cria a sessão derivando a chave; salt e iterações ficam prontos para recifrar. */
export async function criarSessao(
  senha: string,
  opcoes: { iteracoes?: number; salt?: Uint8Array } = {},
): Promise<SessaoCripto> {
  const senhaValida = validarChave(senha)
  const salt = opcoes.salt ?? gerarBytesAleatorios(SALT_BYTES)
  const iteracoes = opcoes.iteracoes ?? KDF_ITERACOES

  if (salt.length !== SALT_BYTES) {
    throw new CriptografiaInvalidaError(`O salt da sessão deve ter ${SALT_BYTES} bytes.`)
  }
  if (!Number.isInteger(iteracoes) || iteracoes < 1) {
    throw new CriptografiaInvalidaError(
      'O número de iterações da sessão deve ser um inteiro positivo.',
    )
  }

  const chave = await derivarChave(senhaValida, salt, iteracoes)
  return { chave, salt, iteracoes }
}

/** Cifra o conteúdo e monta o container com cabeçalho novo (IV novo). */
export async function cifrarArquivo(dados: Uint8Array, sessao: SessaoCripto): Promise<Uint8Array> {
  const iv = gerarBytesAleatorios(IV_BYTES)
  const json = montarCabecalho({ iteracoes: sessao.iteracoes, salt: sessao.salt, iv })
  const cabecalho = concatenar(
    magicBytes(),
    new Uint8Array([NOVA_LINHA]),
    encoder.encode(json),
    new Uint8Array([NOVA_LINHA]),
  )

  const { ciphertext } = await cifrarBytes(sessao.chave, dados, cabecalho, iv)
  return concatenar(cabecalho, ciphertext)
}

/**
 * Decifra o container usando o IV e o AAD gravados no próprio arquivo.
 *
 * Qualquer falha (magic ausente, cabeçalho adulterado, tag inválida) vira
 * `ChaveIncorretaError`: para a UI existe uma única mensagem possível, e não se
 * deve revelar qual byte estava errado.
 */
export async function decifrarArquivo(bytes: Uint8Array, chave: CryptoKey): Promise<Uint8Array> {
  try {
    const { cabecalho, inicioCiphertext } = localizarCabecalho(bytes)
    const aad = bytes.slice(0, inicioCiphertext)
    return await decifrarBytes(chave, cabecalho.iv, bytes.subarray(inicioCiphertext), aad)
  } catch {
    throw new ChaveIncorretaError()
  }
}

/** Deriva a chave com os parâmetros do arquivo e devolve sessão + conteúdo. */
export async function abrirComSenha(
  bytes: Uint8Array,
  senha: string,
): Promise<{ sessao: SessaoCripto; dados: Uint8Array }> {
  const senhaValida = validarChave(senha)
  const cabecalho = lerCabecalho(bytes)
  const chave = await derivarChave(senhaValida, cabecalho.salt, cabecalho.iteracoes)
  const sessao: SessaoCripto = { chave, salt: cabecalho.salt, iteracoes: cabecalho.iteracoes }

  return { sessao, dados: await decifrarArquivo(bytes, chave) }
}

function localizarCabecalho(bytes: Uint8Array): {
  cabecalho: CabecalhoCripto
  inicioCiphertext: number
} {
  if (!temMagic(bytes)) {
    throw new CriptografiaInvalidaError('Arquivo não está no formato cifrado (magic ausente).')
  }

  const inicioJson = MAGIC.length
  if (bytes[inicioJson] !== NOVA_LINHA) {
    throw new CriptografiaInvalidaError('Arquivo cifrado inválido: falta o separador após o magic.')
  }

  const fimJson = bytes.indexOf(NOVA_LINHA, inicioJson + 1)
  if (fimJson < 0) {
    throw new CriptografiaInvalidaError('Arquivo cifrado inválido: cabeçalho truncado.')
  }

  const json = decoder.decode(bytes.subarray(inicioJson + 1, fimJson))
  return { cabecalho: parseCabecalho(json), inicioCiphertext: fimJson + 1 }
}

function concatenar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0)
  const saida = new Uint8Array(total)
  let posicao = 0
  for (const parte of partes) {
    saida.set(parte, posicao)
    posicao += parte.length
  }
  return saida
}
