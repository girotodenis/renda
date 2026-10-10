import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/app/providers/authContext'
import { montarMetaInputs, normalizarMetas } from '@/lib/rebalanceamento'
import type { ConfiguracaoMetas } from '@/lib/rebalanceamento'
import {
  carregarRebalanceamento,
  salvarConfigRebalanceamento,
} from '@/services/rebalanceamento'
import type { RebalanceamentoData } from '@/services/rebalanceamento'
import type { RepositoryContext } from '@/services/repositories'
import { describeSheetsError } from '@/services/sheets'

/** Estado e ações expostas pelo hook de rebalanceamento. */
export interface UseRebalanceamentoResult {
  data: RebalanceamentoData | null
  isLoading: boolean
  isRefreshing: boolean
  isSaving: boolean
  error: string | null
  notice: string | null
  /** Relê os dados da API (refresh explícito). */
  refresh: () => Promise<void>
  /** Persiste a configuração de metas na planilha. */
  salvar: (config: ConfiguracaoMetas) => Promise<boolean>
}

/**
 * Carrega a carteira consolidada e a configuração de metas (cache-first) e
 * persiste as metas na aba `Metas_Rebalanceamento` (Etapa 6 / RF12–RF17).
 */
export function useRebalanceamento(): UseRebalanceamentoResult {
  const { workspace, ensureAccessToken } = useAuth()
  const [data, setData] = useState<RebalanceamentoData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure uma planilha para usar o rebalanceamento.')
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
    async (forceRefresh: boolean) => {
      if (forceRefresh) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)
      try {
        const context = await resolveContext()
        if (!context) return
        setData(await carregarRebalanceamento(context, { forceRefresh }))
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
    void load(false)
  }, [load])

  const refresh = useCallback(async () => {
    await load(true)
  }, [load])

  const salvar = useCallback(
    async (config: ConfiguracaoMetas): Promise<boolean> => {
      if (!data) return false
      setIsSaving(true)
      setError(null)
      setNotice(null)
      try {
        const context = await resolveContext()
        if (!context) return false
        const metasEfetivas = normalizarMetas(montarMetaInputs(data.carteira, config))
        await salvarConfigRebalanceamento(context, config, data.carteira, metasEfetivas)
        setData({ ...data, config })
        setNotice('Metas de rebalanceamento salvas na planilha.')
        return true
      } catch (saveError) {
        setError(describeSheetsError(saveError))
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [data, resolveContext],
  )

  return { data, isLoading, isRefreshing, isSaving, error, notice, refresh, salvar }
}
