import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { sincronizarPendentes } from '@/application/sync'
import type { SyncResult } from '@/application/sync'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Disparador central da sincronização (Fase 2) e fonte do estado exibido pela
 * UX de sincronização (Fase 4).
 *
 * Reaplica as mutações pendentes do outbox quando há rede, nos seguintes
 * momentos: ao montar o layout, a cada reconexão (`window.online`) e em retry
 * periódico (60s) **enquanto houver pendências**. Nenhum disparador roda a
 * lógica de sincronização duas vezes em paralelo (`inFlightRef`).
 *
 * Além dos disparos automáticos, expõe `syncNow()` para forçar o flush (botão
 * "Sincronizar agora") e o estado do último ciclo (`status`/`ultimoResultado`).
 *
 * A fila é consultada apenas indiretamente — pelo resultado de
 * `sincronizarPendentes` — para manter a regra de dependência
 * `presentation → application`.
 */

/** Intervalo do retry periódico enquanto houver mutações pendentes. */
const SYNC_RETRY_INTERVAL_MS = 60_000

/** Fase do último ciclo de sincronização, para a UX (Fase 4). */
export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'error'

/** Estado e ações expostos por `useSync`. */
export interface SyncController {
  /** Força um flush imediato (respeita a trava de concorrência `inFlightRef`). */
  syncNow: () => Promise<SyncResult | null>
  /** Fase do último ciclo: `idle` | `syncing` | `ok` | `error`. */
  status: SyncPhase
  /** Último `SyncResult` concluído (`null` antes do primeiro ciclo). */
  ultimoResultado: SyncResult | null
}

export function useSync(): SyncController {
  const { workspace, ensureAccessToken } = useAuth()
  const online = useOnlineStatus()

  const [status, setStatus] = useState<SyncPhase>('idle')
  const [ultimoResultado, setUltimoResultado] = useState<SyncResult | null>(null)

  const inFlightRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const workspaceRef = useRef(workspace)
  const onlineRef = useRef(online)
  const ensureAccessTokenRef = useRef(ensureAccessToken)

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

  useEffect(() => {
    onlineRef.current = online
  }, [online])

  useEffect(() => {
    ensureAccessTokenRef.current = ensureAccessToken
  }, [ensureAccessToken])

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (inFlightRef.current) return null
    const currentWorkspace = workspaceRef.current
    if (!currentWorkspace || !onlineRef.current) return null

    inFlightRef.current = true
    setStatus('syncing')
    try {
      const token = await ensureAccessTokenRef.current()
      if (!token) {
        setStatus('idle')
        return null
      }
      const resultado = await sincronizarPendentes(
        { accessToken: token, spreadsheetId: currentWorkspace.spreadsheetId },
        { obterToken: () => ensureAccessTokenRef.current() },
      )
      setUltimoResultado(resultado)
      // `error` se houve falha; `ok` se a fila zerou; `idle` se ainda há
      // pendências (ex.: rede caiu no meio do flush) — não é erro definitivo.
      setStatus(resultado.erro ? 'error' : resultado.pendentes > 0 ? 'idle' : 'ok')
      return resultado
    } catch {
      // Best-effort: falhas de sincronização nunca derrubam a UI.
      setStatus('error')
      return null
    } finally {
      inFlightRef.current = false
    }
  }, [])

  const runAndSchedule = useCallback(async () => {
    const resultado = await sync()
    clearRetryTimer()
    if (resultado && resultado.pendentes > 0 && onlineRef.current) {
      retryTimerRef.current = window.setTimeout(
        () => void runAndSchedule(),
        SYNC_RETRY_INTERVAL_MS,
      )
    }
  }, [clearRetryTimer, sync])

  // Dispara ao montar (uma vez) e a cada mudança de conectividade (reconexão).
  useEffect(() => {
    void runAndSchedule()
  }, [runAndSchedule, online])

  // Limpa o timer de retry ao desmontar.
  useEffect(() => clearRetryTimer, [clearRetryTimer])

  return { syncNow: sync, status, ultimoResultado }
}
