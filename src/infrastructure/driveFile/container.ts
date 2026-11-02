/**
 * Container do arquivo do banco no Drive: JSON + gzip e, opcionalmente, cifra
 * (`PLANO_CRIPTOGRAFIA.md` §3.2).
 *
 * A ordem importa: **comprimir antes de cifrar**. Cifrar primeiro tornaria o
 * conteúdo incomprimível e o arquivo cresceria sem ganho.
 *
 * Este módulo é a única ponte entre o codec puro (`format.ts`, que não conhece
 * criptografia) e o envelope (`cripto/envelope.ts`, que não conhece o schema do
 * banco). Assim o formato do banco continua testável sozinho e o envelope
 * também.
 */

import {
  ChaveNecessariaError,
  cifrarArquivo,
  decifrarArquivo,
  estaCifrado,
} from '@/infrastructure/cripto/envelope'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import { gunzip } from '@/infrastructure/compression'
import { DatabaseFileError, encodeDatabaseFile } from '@/infrastructure/driveFile/format'
import type { DatabaseSheets } from '@/infrastructure/driveFile/format'

const DESCOMPRESSAO_FALHOU =
  'Não foi possível descompactar o arquivo do banco de dados.'
const JSON_INVALIDO =
  'Arquivo do banco de dados inválido: não foi possível ler o JSON.'

/** Resultado da leitura: o objeto já parseado e se ele veio cifrado. */
export interface BancoDecodificado {
  raw: unknown
  criptografado: boolean
}

/**
 * Serializa (JSON), comprime (gzip) e — quando há sessão — cifra o banco.
 *
 * Sem sessão o resultado é exatamente o arquivo atual (gzip), então bancos
 * criados antes da criptografia continuam sendo gravados no mesmo formato.
 */
export async function codificarBanco(
  sheets: DatabaseSheets,
  version: number,
  sessao: SessaoCripto | null,
): Promise<Uint8Array> {
  const compactado = await encodeDatabaseFile(sheets, version)
  return sessao ? cifrarArquivo(compactado, sessao) : compactado
}

/**
 * Lê o banco a partir dos bytes do arquivo.
 *
 * A detecção do formato é **só** pelo magic: "não é gzip" nunca é usado porque o
 * gzip pode estar desabilitado e o arquivo em claro pode ser JSON cru. Arquivo
 * cifrado sem chave na sessão vira `ChaveNecessariaError` (fluxo de bloqueio),
 * e chave errada vira `ChaveIncorretaError` (tag do AES-GCM).
 */
export async function decodificarBanco(
  bytes: Uint8Array,
  chave: CryptoKey | null,
): Promise<BancoDecodificado> {
  if (estaCifrado(bytes)) {
    if (!chave) throw new ChaveNecessariaError()
    const dados = await decifrarArquivo(bytes, chave)
    return { raw: parseJson(await descompactar(dados)), criptografado: true }
  }

  return { raw: parseJson(await descompactar(bytes)), criptografado: false }
}

/** `gunzip` também aceita bytes crus (ambiente sem `DecompressionStream`). */
async function descompactar(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await gunzip(bytes)
  } catch {
    throw new DatabaseFileError(DESCOMPRESSAO_FALHOU)
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new DatabaseFileError(JSON_INVALIDO)
  }
}
