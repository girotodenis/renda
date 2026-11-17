import { useCallback, useEffect, useState } from 'react'
import {
  carregarPainelConsolidacao,
  executarConsolidacao,
  simularConsolidacao,
} from '@/application/consolidacao'
import type {
  PainelConsolidacao,
  ResultadoExecucaoConsolidacao,
} from '@/application/consolidacao'
import { exportarPlanilhaOds } from '@/application/exportar'
import type { AlvoConsolidacao, ResultadoConsolidacaoCalculada } from '@/domain/consolidacao'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import { useAuth } from '@/presentation/app/providers/authContext'
import { useOnlineStatus } from '@/presentation/hooks/useOnlineStatus'

/** Resultado da simulação exibida no modal de confirmação. */
export type SimulacaoConsolidacao = ResultadoConsolidacaoCalculada | { erro: string }

/** Estado e ações da página **Consolidação**. */
export interface UseConsolidacaoResult {
  painel: PainelConsolidacao | null
  isLoading: boolean
  isRefreshing: boolean
  isExecutando: boolean
  isExportando: boolean
  /** `true` sem conexão (fora do modo local): consolidação fica bloqueada. */
  isOffline: boolean
  error: string | null
  notice: string | null
  refresh: () => Promise<void>
  /** Simula o escopo nos dados já carregados (não grava nada). */
  simular: (alvo: AlvoConsolidacao) => SimulacaoConsolidacao
  /** Executa a consolidação (relê da API, verifica invariantes e grava). */
  consolidar: (alvo: AlvoConsolidacao) => Promise<ResultadoExecucaoConsolidacao | null>
  /** Exporta o backup `.ods` completo antes de consolidar. */
  exportarBackup: () => Promise<void>
}

/**
 * Hook da página **Consolidação** (`PLANO_CONSOLIDACAO.md` §5).
 *
 * A leitura é cache-first (a página abre offline com o último estado salvo); a
 * gravação exige conexão e é sempre uma ação explícita do usuário.
 */
export function useConsolidacao(): UseConsolidacaoResult {
  const { workspace, ensureAccessToken, isModoLocal } = useAuth()
  const online = useOnlineStatus()
  const [painel, setPainel] = useState<PainelConsolidacao | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExecutando, setIsExecutando] = useState(false)
  const [isExportando, setIsExportando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure um banco de dados antes de consolidar.')
      return null
    }
    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return null
    }
    return { accessToken: token, spreadsheetId: workspace.spreadsheetId }
  }, [workspace, ensureAccessToken])

  const load = useCallback(
    async (forceRefresh = false) => {
      const context = await resolveContext()
      if (!context) return
      if (forceRefresh) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)
      try {
        setPainel(await carregarPainelConsolidacao(context, { forceRefresh }))
      } catch (loadError) {
        setError(describeSheetsError(loadError))
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [resolveContext],
  )

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    setNotice(null)
    await load(true)
  }, [load])

  const simular = useCallback(
    (alvo: AlvoConsolidacao): SimulacaoConsolidacao => {
      if (!painel) return { erro: 'Carregue a lista antes de consolidar.' }
      return simularConsolidacao(alvo, painel.operacoes, painel.proventos)
    },
    [painel],
  )

  const consolidar = useCallback(
    async (alvo: AlvoConsolidacao): Promise<ResultadoExecucaoConsolidacao | null> => {
      const context = await resolveContext()
      if (!context) return null
      setIsExecutando(true)
      setError(null)
      setNotice(null)
      try {
        const resultado = await executarConsolidacao(context, alvo)
        setNotice(
          `Consolidação concluída: ${resultado.absorvidas} linha(s) substituída(s) por ${resultado.geradas}.`,
        )
        setPainel(await carregarPainelConsolidacao(context))
        return resultado
      } catch (executarError) {
        setError(describeSheetsError(executarError))
        return null
      } finally {
        setIsExecutando(false)
      }
    },
    [resolveContext],
  )

  const exportarBackup = useCallback(async () => {
    if (!workspace) return
    const accessToken = await ensureAccessToken()
    if (!accessToken) {
      setError('Sessão expirada. Faça login novamente.')
      return
    }
    setIsExportando(true)
    setError(null)
    try {
      const resultado = await exportarPlanilhaOds(
        { accessToken, spreadsheetId: workspace.spreadsheetId },
        workspace.title,
        new Date().toISOString(),
      )
      if (resultado.status !== 'cancelado') {
        setNotice(`Backup ${resultado.nome} gerado com todas as abas.`)
      }
    } catch (exportError) {
      setError(describeSheetsError(exportError))
    } finally {
      setIsExportando(false)
    }
  }, [workspace, ensureAccessToken])

  return {
    painel,
    isLoading,
    isRefreshing,
    isExecutando,
    isExportando,
    isOffline: !online && !isModoLocal,
    error,
    notice,
    refresh,
    simular,
    consolidar,
    exportarBackup,
  }
}
