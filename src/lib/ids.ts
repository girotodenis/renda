/**
 * Geração de identificadores únicos para lançamentos (`Operacoes`/`Proventos`).
 *
 * Regra: nunca reutilizar um ID. Usa `crypto.randomUUID()` quando disponível
 * (contexto seguro) e cai para timestamp + aleatório como fallback.
 */
export function newId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
