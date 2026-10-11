import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { sincronizarPendentes } from '@/application/sync'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Disparador central da sincronização (Fase 2 do plano PWA).
 *
 * Reaplica as mutações pendentes do outbox quando há rede, nos seguintes
 * momentos: ao montar o layout, a cada reconexão (`window.online`) e em retry
 * periódico (60s) **enquanto houver pendências**. Nenhum disparador roda a
 * lógica de sincronização duas vezes em paralelo (`inFlightRef`).
 *
 * A fila é consultada apenas indiretamente — pelo resultado de
 * `sincronizarPendentes` — para manter a regra de dependência
 * `presentation → application`.
 */

/** Intervalo do retry periódico enquanto houver mutações pendentes. */
const SYNC_RETRY_INTERVAL_MS = 60_000

export function useSync(): void {
  const { workspace, ensureAccessToken } = useAuth()
  const online = useOnlineStatus()

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

  const sync = useCallback(async () => {
    if (inFlightRef.current) return null
    const currentWorkspace = workspaceRef.current
    if (!currentWorkspace || !onlineRef.current) return null

    inFlightRef.current = true
    try {
      const token = await ensureAccessTokenRef.current()
      if (!token) return null
      return await sincronizarPendentes(
        { accessToken: token, spreadsheetId: currentWorkspace.spreadsheetId },
        { obterToken: () => ensureAccessTokenRef.current() },
      )
    } catch {
      // Best-effort: falhas de sincronização nunca derrubam a UI.
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
}
