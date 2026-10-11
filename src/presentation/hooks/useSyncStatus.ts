import { useCallback, useEffect, useState } from 'react'
import { contarPendencias } from '@/application/sync'
import type { SyncResult } from '@/application/sync'
import { useOnlineStatus } from './useOnlineStatus'
import { useSync } from './useSync'
import type { SyncPhase } from './useSync'

/**
 * Estado consolidado para a UX de sincronização (Fase 4 do plano PWA).
 *
 * Combina o estado de conexão (`useOnlineStatus`) com o motor de sincronização
 * (`useSync`) e a contagem de pendências da fila offline. A contagem é obtida
 * via `contarPendencias()` — wrapper de `application/sync` — para não importar
 * `infrastructure` na apresentação (regra `presentation → application`).
 *
 * A contagem é recalculada: ao montar, a cada mudança de conectividade
 * (reconexão) e sempre que um ciclo de sincronização termina — incluindo os
 * disparados automaticamente pelo retry periódico da `useSync`.
 */

/** Estado consolidado exibido pelo `SyncStatusBadge`. */
export interface SyncStatus {
  /** Estado de conexão observado pelo navegador. */
  online: boolean
  /** Quantidade de alterações ainda pendentes na fila offline. */
  pendentes: number
  /** Fase do último ciclo de sincronização. */
  status: SyncPhase
  /** Quantas mutações o último ciclo aplicou (para o "ok" discreto). */
  aplicadas: number
  /** Primeira falha do último ciclo, se houver. */
  erro?: string
  /** Força um flush imediato e recontabiliza a fila. */
  syncNow: () => Promise<SyncResult | null>
}

export function useSyncStatus(): SyncStatus {
  const online = useOnlineStatus()
  const { syncNow: runSync, status, ultimoResultado } = useSync()
  const [pendentes, setPendentes] = useState<number>(() => contarPendencias())

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    const resultado = await runSync()
    // Recontabiliza imediatamente após o flush manual.
    setPendentes(contarPendencias())
    return resultado
  }, [runSync])

  // Reconta ao montar e a cada mudança de conectividade (reconexão/queda).
  useEffect(() => {
    setPendentes(contarPendencias())
  }, [online])

  // Reconta sempre que um ciclo de sincronização termina (inclusive os
  // disparados automaticamente pelo mount/retry periódico da `useSync`).
  useEffect(() => {
    setPendentes(contarPendencias())
  }, [status, ultimoResultado])

  return {
    online,
    pendentes,
    status,
    aplicadas: ultimoResultado?.aplicadas ?? 0,
    erro: ultimoResultado?.erro,
    syncNow,
  }
}
