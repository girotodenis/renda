import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { carregarDashboard, lerDashboardDoCache } from '@/application/dashboard'
import type { DashboardData } from '@/application/dashboard'
import { persistirESincronizarCotacoesBrapi } from '@/application/brapi'
import { jaTemSnapshotDeHoje, registrarSnapshot, upsertHistorico } from '@/application/historico'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import { useOnlineStatus } from '@/presentation/hooks/useOnlineStatus'

/** Extrai os preços (centavos) dos tickers cuja cotação veio da Brapi (fallback). */
function cotacoesBrapiDoDashboard(data: DashboardData): Map<string, number> {
  const precos = new Map<string, number>()
  for (const cotacao of data.cotacoes.values()) {
    if (cotacao.fonte === 'brapi' && !cotacao.usandoFallback) {
      precos.set(cotacao.ticker, cotacao.precoAtual)
    }
  }
  return precos
}

/** Persiste (best-effort) as cotações Brapi do dashboard na planilha. */
async function persistirCotacoesBrapiDoDashboard(
  context: RepositoryContext,
  data: DashboardData,
): Promise<void> {
  const precos = cotacoesBrapiDoDashboard(data)
  if (precos.size === 0) return
  try {
    await persistirESincronizarCotacoesBrapi(context, precos)
  } catch {
    // Best-effort (RNF04): nunca bloqueia o dashboard.
  }
}

/** Estado e ações expostas pelo hook do dashboard. */
export interface UseDashboardResult {
  data: DashboardData | null
  isLoading: boolean
  isRefreshing: boolean
  isSavingSnapshot: boolean
  /** `true` quando os dados exibidos vêm do cache local sem rede (RNF08). */
  isOffline: boolean
  error: string | null
  notice: string | null
  /** Relê os dados da API (refresh explícito). */
  refresh: () => Promise<void>
  /** Grava um snapshot manual no `Historico` (Seção 2). */
  registrarSnapshotManual: () => Promise<void>
}

/**
 * Carrega os dados do dashboard (cache-first) e mantém o snapshot automático
 * do `Historico` (RF18, Seção 2).
 *
 * O snapshot automático ocorre uma vez por montagem, apenas quando ainda não
 * existe um snapshot para o dia — evitando escritas desnecessárias. Ele é
 * best-effort: falhas não interrompem a renderização (RNF04).
 */
export function useDashboard(): UseDashboardResult {
  const { workspace, ensureAccessToken } = useAuth()
  const online = useOnlineStatus()
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const autoSnapshotRef = useRef(false)

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure uma planilha para visualizar o dashboard.')
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
        if (!workspace) {
          setError('Configure uma planilha para visualizar o dashboard.')
          return
        }
        // Sem cache local não há o que exibir offline (RNF08).
        const cache = lerDashboardDoCache(workspace.spreadsheetId)
        if (!online) {
          if (cache) {
            setData(cache)
            setIsOffline(true)
          } else {
            setError('Sem conexão e sem dados em cache. Conecte-se para carregar a carteira.')
          }
          return
        }
        const context = await resolveContext()
        if (!context) {
          if (cache) {
            setData(cache)
            setIsOffline(true)
          }
          return
        }
        const resultado = await carregarDashboard(context, { forceRefresh })
        setData(resultado)
        setIsOffline(false)
        // Persistência best-effort das cotações Brapi usadas como fallback:
        // grava o preço na planilha (mesmo fluxo da marcação manual).
        void persistirCotacoesBrapiDoDashboard(context, resultado)
      } catch (loadError) {
        const cache = workspace ? lerDashboardDoCache(workspace.spreadsheetId) : null
        if (cache) {
          setData(cache)
          setIsOffline(true)
        } else {
          setError(describeSheetsError(loadError))
        }
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [resolveContext, workspace, online],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    if (!data || autoSnapshotRef.current || isOffline) return
    autoSnapshotRef.current = true

    const carteiraVazia = data.resumo.patrimonioTotal === 0 && data.resumo.totalInvestido === 0
    if (carteiraVazia || jaTemSnapshotDeHoje(data.historico)) return

    void (async () => {
      const context = await resolveContext()
      if (!context) return
      try {
        const snapshot = await registrarSnapshot(context, data.resumo)
        setData((atual) =>
          atual ? { ...atual, historico: upsertHistorico(atual.historico, snapshot) } : atual,
        )
      } catch {
        // Snapshot automático é best-effort — nunca bloqueia o dashboard.
      }
    })()
  }, [data, resolveContext, isOffline])

  const refresh = useCallback(async () => {
    await load(true)
  }, [load])

  const registrarSnapshotManual = useCallback(async () => {
    if (!data) return
    setIsSavingSnapshot(true)
    setError(null)
    setNotice(null)
    try {
      const context = await resolveContext()
      if (!context) return
      const snapshot = await registrarSnapshot(context, data.resumo)
      setData((atual) =>
        atual ? { ...atual, historico: upsertHistorico(atual.historico, snapshot) } : atual,
      )
      setNotice('Snapshot do patrimônio registrado no Histórico.')
    } catch (snapshotError) {
      setError(describeSheetsError(snapshotError))
    } finally {
      setIsSavingSnapshot(false)
    }
  }, [data, resolveContext])

  return {
    data,
    isLoading,
    isRefreshing,
    isSavingSnapshot,
    isOffline,
    error,
    notice,
    refresh,
    registrarSnapshotManual,
  }
}
