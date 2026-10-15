import {
  MODO_ARMAZENAMENTO_PADRAO,
  parseModoArmazenamento,
} from '@/domain/armazenamento'
import type { ModoArmazenamento } from '@/domain/armazenamento'
import { readStorageJson, writeStorageJson } from '@/infrastructure/storage'

/**
 * Persistência do modo de armazenamento ativo (RF01).
 *
 * Fica no `localStorage` (metadado da sessão, como token/workspace) com espelho
 * em memória, porque o roteamento dos adaptadores precisa decidir de forma
 * **síncrona** para qual destino uma leitura/escrita vai.
 */

const STORAGE_KEY = 'minhaacoes.modo.v1'

let cached: ModoArmazenamento | null = null

/** Modo de armazenamento ativo (leitura síncrona, com cache em memória). */
export function getModoArmazenamento(): ModoArmazenamento {
  if (cached === null) {
    cached = parseModoArmazenamento(readStorageJson<string>(STORAGE_KEY) ?? MODO_ARMAZENAMENTO_PADRAO)
  }
  return cached
}

/** Define e persiste o modo de armazenamento ativo. */
export function setModoArmazenamento(modo: ModoArmazenamento): void {
  cached = modo
  writeStorageJson(STORAGE_KEY, modo)
}

/** `true` quando a carteira está no banco local do navegador (sem Google). */
export function isModoLocal(): boolean {
  return getModoArmazenamento() === 'local'
}

/** Limpa o espelho em memória (apenas testes, que trocam o `localStorage`). */
export function _resetModoArmazenamentoForTests(): void {
  cached = null
}
