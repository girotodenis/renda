import { newId } from '@/domain/ids'
import type { SheetName } from '@/domain/sheetsSchema'
import { readStorageJson, removeStorageKey, writeStorageJson } from '@/infrastructure/storage'

/**
 * Outbox — fila persistente de mutações offline (Fase 1 do plano PWA).
 *
 * Toda escrita que **não** puder ir imediatamente para a planilha (sem rede ou
 * falha de rede/quota) é registrada aqui e reaplicada depois pela sincronização
 * (Fase 2). A fila vive no `localStorage`, então sobrevive a recargas do app.
 */

/** Chave versionada da fila no `localStorage`. */
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
  const stored = readStorageJson<Mutation[]>(OUTBOX_STORAGE_KEY)
  return Array.isArray(stored) ? stored : []
}

function writeAll(mutations: readonly Mutation[]): void {
  writeStorageJson(OUTBOX_STORAGE_KEY, mutations)
}

/** Adiciona uma mutação ao fim da fila e devolve o registro persistido. */
export function enqueue(draft: MutationDraft): Mutation {
  const mutation: Mutation = {
    ...draft,
    id: newId(),
    createdAt: new Date().toISOString(),
  }
  const mutations = readAll()
  mutations.push(mutation)
  writeAll(mutations)
  return mutation
}

/** Lista as mutações pendentes, em ordem FIFO de enfileiramento. */
export function list(): Mutation[] {
  return readAll()
}

/** Remove uma mutação pelo ID (usada após o sucesso da sincronização). */
export function remove(id: string): void {
  writeAll(readAll().filter((mutation) => mutation.id !== id))
}

/** Esvazia a fila. */
export function clear(): void {
  removeStorageKey(OUTBOX_STORAGE_KEY)
}

/** Quantidade de mutações pendentes. */
export function count(): number {
  return readAll().length
}

/**
 * Estado de conexão segundo o navegador. Ambientes sem `navigator` (testes
 * Node/SSR) são tratados como **online** (comportamento padrão da aplicação).
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}
