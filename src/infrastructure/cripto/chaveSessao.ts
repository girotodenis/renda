/**
 * Chaves desbloqueadas em memória, uma por banco (`PLANO_CRIPTOGRAFIA.md` §3.3).
 *
 * Nada aqui toca `localStorage`, `sessionStorage` ou IndexedDB: a chave mora só
 * neste `Map` e desaparece no reload. É o comportamento desejado — reload pede a
 * senha de novo. O id é o `spreadsheetId` (ou o id sintético `local`).
 */

import type { SessaoCripto } from '@/infrastructure/cripto/envelope'

const chaves = new Map<string, SessaoCripto>()

/** `true` quando o banco está desbloqueado nesta sessão. */
export function temChave(id: string): boolean {
  return chaves.has(id)
}

/** Guarda a sessão do banco (substitui a anterior, se houver). */
export function guardarChave(id: string, sessao: SessaoCripto): void {
  chaves.set(id, sessao)
}

/** Sessão do banco, ou `null` quando ele está bloqueado. */
export function obterChave(id: string): SessaoCripto | null {
  return chaves.get(id) ?? null
}

/** "Bloquear agora" / troca de banco / logout. */
export function esquecerChave(id: string): void {
  chaves.delete(id)
}

/** Logout: desbloqueia nada, esquece todos os bancos. */
export function esquecerTodasAsChaves(): void {
  chaves.clear()
}

/** Limpa o estado entre testes (o módulo é um singleton). */
export function _resetChavesForTests(): void {
  chaves.clear()
}
