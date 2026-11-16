import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { contarPendencias, sincronizarPendentes } from '@/application/sync'
import type { SyncResult } from '@/application/sync'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import { onEnqueue } from '@/infrastructure/outbox'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Disparador central da sincronização (Fase 2) e fonte do estado exibido pela
 * UX de sincronização (Fase 4).
 *
 * Como as escritas são **local-first**, este hook é o que leva a fila ao banco.
 * O flush é agendado:
 *
 * - **debounce de 10 s** a cada mutação enfileirada (a rajada de um salvamento
 *   vira uma única ida à origem), com **teto de 30 s** para quem edita sem parar;
 * - imediatamente ao esconder/fechar a aba (`visibilitychange`/`pagehide`), para
 *   não deixar alteração só no navegador;
 * - ao montar o layout, a cada reconexão (`window.online`) e quando o estado da
 *   sessão muda (para retomar logo após o desbloqueio);
 * - em retry periódico (60 s) **enquanto houver pendências**, cobrindo falhas
 *   não recuperáveis (403/500) que mantêm itens na fila.
 *
 * Nenhum disparador roda a lógica de sincronização duas vezes em paralelo
 * (`inFlightRef`).
 *
 * Com o banco **bloqueado** nada é enviado: sem a chave o flush falharia no
 * `upload` (o gateway se recusa a gravar em claro) e só gastaria rede. A fila
 * espera o desbloqueio.
 *
 * Além dos disparos automáticos, expõe `syncNow()` para forçar o flush (botão
 * "Sincronizar agora") e o estado do último ciclo (`status`/`ultimoResultado`).
 *
 * A fila é consultada apenas indiretamente — pelo resultado de
 * `sincronizarPendentes` — para manter a regra de dependência
 * `presentation → application`.
 */

/** Janela de silêncio antes de gravar a fila (rajada de um salvamento = 1 envio). */
const SYNC_DEBOUNCE_MS = 10_000

/** Teto de espera: quem edita sem parar não adia o envio indefinidamente. */
const SYNC_MAX_WAIT_MS = 30_000

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
  const { workspace, ensureAccessToken, status: authStatus } = useAuth()
  const online = useOnlineStatus()

  const [status, setStatus] = useState<SyncPhase>('idle')
  const [ultimoResultado, setUltimoResultado] = useState<SyncResult | null>(null)

  const inFlightRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const debounceTimerRef = useRef<number | null>(null)
  const maxWaitTimerRef = useRef<number | null>(null)
  const workspaceRef = useRef(workspace)
  const onlineRef = useRef(online)
  const ensureAccessTokenRef = useRef(ensureAccessToken)
  const authStatusRef = useRef(authStatus)

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

  useEffect(() => {
    onlineRef.current = online
  }, [online])

  useEffect(() => {
    ensureAccessTokenRef.current = ensureAccessToken
  }, [ensureAccessToken])

  useEffect(() => {
    authStatusRef.current = authStatus
  }, [authStatus])

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  /** Cancela o agendamento por debounce (janela de silêncio + teto). */
  const clearScheduledFlush = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (maxWaitTimerRef.current !== null) {
      window.clearTimeout(maxWaitTimerRef.current)
      maxWaitTimerRef.current = null
    }
  }, [])

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (inFlightRef.current) return null
    const currentWorkspace = workspaceRef.current
    if (!currentWorkspace || !onlineRef.current) return null

    // Banco bloqueado: a fila espera a chave (não há como decifrar nem gravar).
    if (authStatusRef.current === 'bloqueado') return null

    // Modo local: a "planilha" já é o banco do navegador — não existe fila a
    // enviar (mutações pendentes do Google nunca são reaplicadas aqui).
    if (isModoLocal()) return null

    // Sem pendências, não há motivo para falar com o Google — evita renovar o
    // token (e qualquer interação de login) sem necessidade. A autenticação só
    // é solicitada quando existe algo salvo localmente para sincronizar.
    if (contarPendencias() === 0) return null

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

  /** Roda o flush e reagenda o próximo ciclo se ainda houver fila. */
  const runAndSchedule = useCallback(async (): Promise<SyncResult | null> => {
    clearScheduledFlush()
    const resultado = await sync()
    clearRetryTimer()

    // Sobrou fila: ou o flush falhou, ou uma escrita entrou enquanto ele rodava
    // (a fila é lida no início do ciclo). Só o ciclo que fez progresso volta na
    // janela do debounce; falha (ou ciclo que nem rodou — sem token, in-flight)
    // espera o retry longo para não insistir no que não vai passar.
    if (!onlineRef.current || contarPendencias() === 0) return resultado
    const fezProgresso = resultado !== null && !resultado.erro
    const espera = fezProgresso ? SYNC_DEBOUNCE_MS : SYNC_RETRY_INTERVAL_MS
    retryTimerRef.current = window.setTimeout(() => void runAndSchedule(), espera)
    return resultado
  }, [clearRetryTimer, clearScheduledFlush, sync])

  /**
   * Agenda o flush: 10 s após a última escrita, com teto de 30 s contado a
   * partir da primeira escrita da rajada.
   */
  const agendarFlush = useCallback(() => {
    if (isModoLocal() || typeof window === 'undefined') return

    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      void runAndSchedule()
    }, SYNC_DEBOUNCE_MS)

    if (maxWaitTimerRef.current === null) {
      maxWaitTimerRef.current = window.setTimeout(() => {
        maxWaitTimerRef.current = null
        void runAndSchedule()
      }, SYNC_MAX_WAIT_MS)
    }
  }, [runAndSchedule])

  // Toda mutação enfileirada reagenda o flush (padrão outbox).
  useEffect(() => onEnqueue(agendarFlush), [agendarFlush])

  // Dispara ao montar (uma vez), a cada mudança de conectividade (reconexão) e
  // quando o estado da sessão muda — é assim que o flush volta a rodar logo
  // depois do desbloqueio.
  useEffect(() => {
    void runAndSchedule()
  }, [runAndSchedule, online, authStatus])

  // Aba escondida/fechada: melhor esforço para não deixar a fila só no navegador.
  useEffect(() => {
    if (typeof document === 'undefined') return

    const aoEsconder = () => {
      if (contarPendencias() === 0) return
      void runAndSchedule()
    }
    const aoTrocarVisibilidade = () => {
      if (document.visibilityState === 'hidden') aoEsconder()
    }

    document.addEventListener('visibilitychange', aoTrocarVisibilidade)
    window.addEventListener('pagehide', aoEsconder)
    return () => {
      document.removeEventListener('visibilitychange', aoTrocarVisibilidade)
      window.removeEventListener('pagehide', aoEsconder)
    }
  }, [runAndSchedule])

  // Limpa os timers ao desmontar.
  useEffect(
    () => () => {
      clearRetryTimer()
      clearScheduledFlush()
    },
    [clearRetryTimer, clearScheduledFlush],
  )

  // O botão "Sincronizar agora" usa o mesmo caminho do flush automático: assim
  // ele também cancela um agendamento pendente e reprograma o próximo ciclo.
  return { syncNow: runAndSchedule, status, ultimoResultado }
}
