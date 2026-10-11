import { newId } from '@/domain/ids'
import type { SheetName } from '@/domain/sheetsSchema'
import { kvClear, kvDelete, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'

/**
 * Outbox — fila persistente de mutações offline (Fase 1 do plano PWA), agora
 * no IndexedDB (Fase 5) com espelho em memória para leitura síncrona.
 *
 * Toda escrita que **não** puder ir imediatamente para a planilha (sem rede ou
 * falha de rede/quota) é registrada aqui e reaplicada depois pela sincronização
 * (Fase 2). A fila vive na object store `outbox` do IndexedDB (uma entrada por
 * mutação, chaveada por `mutation.id`), então sobrevive a recargas do app.
 */

/**
 * Chave legada da fila no `localStorage` (formato das Fases 0–4). Mantida
 * apenas como referência documental/migração — a fila não usa mais esta chave.
 */
export const OUTBOX_STORAGE_KEY = 'minhaacoes.outbox.v1'

/** Tipo de escrita enfileirada (espelha as operações dos repositórios). */
export type MutationKind = 'append' | 'update' | 'remove' | 'replaceAll'

/** Mutação pendente de sincronização com a planilha. */
export interface Mutation {
  /** Identificador único da mutação (`newId()`) — nunca reutilizado. */
  id: string
  /** ISO 8601 do momento em que a mutação foi enfileirada. */
  createdAt: string
  /** Aba alvo da mutação. */
  sheet: SheetName
  kind: MutationKind
  /** Entidade gravada por `append`/`update`. */
  entity?: unknown
  /** Lista completa gravada por `replaceAll`. */
  entities?: readonly unknown[]
  /** ID da entidade afetada por `update`/`remove` (quando conhecido). */
  entityId?: string
}

/** Mutação sem os campos gerados automaticamente (`id`/`createdAt`). */
export type MutationDraft = Omit<Mutation, 'id' | 'createdAt'>

function readAll(): Mutation[] {
  const mutations: Mutation[] = []
  for (const key of kvKeys('outbox')) {
    const mutation = kvGet<Mutation>('outbox', key)
    if (mutation) mutations.push(mutation)
  }
  return mutations
}

/**
 * Ordena por `createdAt` ASC, com `id` como desempate. A ordem de inserção
 * **não** pode ser usada: `newId()` usa `crypto.randomUUID` (não ordenável por
 * tempo), então duas mutações criadas no mesmo milissegundo teriam ordem
 * instável sem o desempate.
 */
function compareByCreatedAt(a: Mutation, b: Mutation): number {
  const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
  if (byCreatedAt !== 0) return byCreatedAt
  return a.id.localeCompare(b.id)
}

/** Adiciona uma mutação ao fim da fila e devolve o registro persistido. */
export function enqueue(draft: MutationDraft): Mutation {
  const mutation: Mutation = {
    ...draft,
    id: newId(),
    createdAt: new Date().toISOString(),
  }
  kvSet('outbox', mutation.id, mutation)
  return mutation
}

/** Lista as mutações pendentes, em ordem FIFO de enfileiramento. */
export function list(): Mutation[] {
  return readAll().sort(compareByCreatedAt)
}

/** Remove uma mutação pelo ID (usada após o sucesso da sincronização). */
export function remove(id: string): void {
  kvDelete('outbox', id)
}

/** Esvazia a fila. */
export function clear(): void {
  kvClear('outbox')
}

/** Quantidade de mutações pendentes. */
export function count(): number {
  return kvKeys('outbox').length
}

/**
 * Estado de conexão segundo o navegador. Ambientes sem `navigator` (testes
 * Node/SSR) são tratados como **online** (comportamento padrão da aplicação).
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}
