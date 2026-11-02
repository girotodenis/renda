/**
 * Cofre do **modo local** (`PLANO_CRIPTOGRAFIA.md` §5.3, Fase 6).
 *
 * No modo local não existe arquivo remoto: o "arquivo" é o próprio IndexedDB.
 * O cofre é o registro que marca "este banco está cifrado" e guarda o material
 * necessário para derivar a chave de novo (`{ versao, kdf, iv, verificador }`).
 *
 * O formato é exatamente o do verificador de desbloqueio offline — o cofre é o
 * verificador do id sintético `local` —, então a derivação de chave e o
 * AES-GCM continuam em um único lugar. As **abas** são cifradas separadamente
 * por `localSheets.ts`; o cofre só guarda a senha derivada.
 */

import type { SessaoCripto } from '@/infrastructure/cripto/envelope'
import {
  abrirVerificador,
  esquecerVerificador,
  guardarVerificador,
  temVerificador,
} from '@/infrastructure/cripto/verificadorLocal'

/** Id sintético do banco local (mesmo `spreadsheetId` do workspace local). */
export const ID_COFRE_LOCAL = 'local'

/** `true` quando o banco local está cifrado neste dispositivo. */
export function temCofreLocal(): boolean {
  return temVerificador(ID_COFRE_LOCAL)
}

/**
 * Cria/substitui o cofre do banco local.
 *
 * A chave **não** é guardada aqui: quem decide mantê-la em memória é
 * `chaveSessao` (`guardarChave`), como no cofre do Drive.
 */
export async function criarCofreLocal(sessao: SessaoCripto): Promise<void> {
  await guardarVerificador(ID_COFRE_LOCAL, sessao)
}

/** Abre o cofre com a senha; `null` quando a senha está errada ou não há cofre. */
export function abrirCofreLocal(senha: string): Promise<SessaoCripto | null> {
  return abrirVerificador(ID_COFRE_LOCAL, senha)
}

/** Desativa a cifra do banco local (as abas são regravadas em claro por quem chama). */
export function removerCofreLocal(): void {
  esquecerVerificador(ID_COFRE_LOCAL)
}
