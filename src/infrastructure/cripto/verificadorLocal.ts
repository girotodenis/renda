/**
 * Verificador por banco para **desbloqueio offline** (`PLANO_CRIPTOGRAFIA.md`
 * §3.3, decisão 10).
 *
 * Sem internet não há arquivo remoto para decifrar, mas o usuário ainda precisa
 * provar que sabe a senha para abrir o cache local. A solução é guardar no
 * IndexedDB um bloco **fixo** cifrado com a chave derivada da senha, junto dos
 * parâmetros do KDF:
 *
 * ```
 * cripto-verificador::<spreadsheetId>
 *   → { versao, kdf: { iteracoes, salt }, iv, verificador }
 * ```
 *
 * A senha e a chave **nunca** são gravadas: o registro só permite derivar a
 * chave de novo e conferir se a tag do AES-GCM valida. O `spreadsheetId` entra
 * como AAD, então um verificador copiado de outro banco não abre.
 */

import {
  IV_BYTES,
  KDF_ITERACOES_MAXIMAS,
  KDF_ITERACOES_MINIMAS,
  SALT_BYTES,
  base64ParaBytes,
  bytesParaBase64,
  validarChave,
} from '@/domain/criptografia'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import { cifrarBytes, decifrarBytes, derivarChave } from '@/infrastructure/cripto/webCrypto'
import { kvDelete, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'

/** Texto fixo cifrado no verificador — não carrega nenhum dado do usuário. */
export const TEXTO_VERIFICADOR = 'MINHASACOES-VERIFICADOR'

/** Versão do registro (permite evoluir o formato sem apagar os antigos). */
const VERSAO = 1

/** Prefixo das chaves dentro da store. */
const PREFIXO = 'cripto-verificador::'

/** O verificador mora na mesma store do cache de abas. */
const STORE = 'sheets'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Registro persistido (salt, IV e bloco cifrado em Base64). */
export interface VerificadorLocal {
  versao: number
  kdf: { iteracoes: number; salt: string }
  iv: string
  verificador: string
}

function chaveDoRegistro(id: string): string {
  return `${PREFIXO}${id}`
}

/**
 * Grava/atualiza o verificador do banco. Chamado logo depois de um desbloqueio
 * bem-sucedido, quando a sessão já tem a chave em memória.
 */
export async function guardarVerificador(id: string, sessao: SessaoCripto): Promise<void> {
  const { iv, ciphertext } = await cifrarBytes(
    sessao.chave,
    encoder.encode(TEXTO_VERIFICADOR),
    encoder.encode(id),
  )

  const registro: VerificadorLocal = {
    versao: VERSAO,
    kdf: { iteracoes: sessao.iteracoes, salt: bytesParaBase64(sessao.salt) },
    iv: bytesParaBase64(iv),
    verificador: bytesParaBase64(ciphertext),
  }
  kvSet(STORE, chaveDoRegistro(id), registro)
}

/**
 * Tenta abrir o verificador com a senha e devolve a sessão pronta para uso.
 *
 * Senha errada, registro ausente ou registro adulterado devolvem `null`: a UI
 * só tem uma mensagem possível ("chave incorreta", §6.7), então nada aqui deve
 * lançar nem diferenciar os motivos.
 */
export async function abrirVerificador(id: string, senha: string): Promise<SessaoCripto | null> {
  const registro = lerRegistro(id)
  if (!registro) return null

  try {
    const salt = base64ParaBytes(registro.kdf.salt)
    const chave = await derivarChave(validarChave(senha), salt, registro.kdf.iteracoes)
    const claro = await decifrarBytes(
      chave,
      base64ParaBytes(registro.iv),
      base64ParaBytes(registro.verificador),
      encoder.encode(id),
    )
    if (decoder.decode(claro) !== TEXTO_VERIFICADOR) return null

    return { chave, salt, iteracoes: registro.kdf.iteracoes }
  } catch {
    return null
  }
}

/** `true` quando o banco tem verificador gravado neste dispositivo. */
export function temVerificador(id: string): boolean {
  return lerRegistro(id) !== null
}

/** Remove o verificador de um banco ("Esquecer este banco"/desativar cifra). */
export function esquecerVerificador(id: string): void {
  kvDelete(STORE, chaveDoRegistro(id))
}

/** Remove os verificadores de todos os bancos do dispositivo. */
export function esquecerTodosOsVerificadores(): void {
  for (const chave of kvKeys(STORE)) {
    if (chave.startsWith(PREFIXO)) kvDelete(STORE, chave)
  }
}

function lerRegistro(id: string): VerificadorLocal | null {
  const bruto = kvGet<unknown>(STORE, chaveDoRegistro(id))
  return ehRegistroValido(bruto) ? bruto : null
}

/**
 * Valida o registro **antes** de derivar a chave: um registro corrompido ou com
 * iterações fora da faixa nunca deve travar a tela nem aceitar um KDF fraco.
 */
function ehRegistroValido(valor: unknown): valor is VerificadorLocal {
  if (typeof valor !== 'object' || valor === null) return false

  const registro = valor as Record<string, unknown>
  if (registro.versao !== VERSAO) return false
  if (typeof registro.kdf !== 'object' || registro.kdf === null) return false

  const { iteracoes, salt } = registro.kdf as Record<string, unknown>
  if (typeof iteracoes !== 'number' || !Number.isInteger(iteracoes)) return false
  if (iteracoes < KDF_ITERACOES_MINIMAS || iteracoes > KDF_ITERACOES_MAXIMAS) return false
  if (typeof salt !== 'string') return false
  if (typeof registro.iv !== 'string') return false
  if (typeof registro.verificador !== 'string') return false

  try {
    if (base64ParaBytes(salt).length !== SALT_BYTES) return false
    if (base64ParaBytes(registro.iv).length !== IV_BYTES) return false
  } catch {
    return false
  }

  return true
}
