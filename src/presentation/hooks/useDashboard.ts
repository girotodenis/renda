import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/presentation/app/providers/authContext'
import { carregarDashboard, lerDashboardDoCache } from '@/application/dashboard'
import type { DashboardData, DiagnosticoCotacoesApi } from '@/application/dashboard'
import { persistirESincronizarCotacoesApi } from '@/application/cotacoesApi'
import { jaTemSnapshotDeHoje, registrarSnapshot, upsertHistorico } from '@/application/historico'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { isAtualizacaoCancelada } from '@/domain/progresso'
import type { AoProgredir, ProgressoAtualizacao } from '@/domain/progresso'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'
import { useOnlineStatus } from '@/presentation/hooks/useOnlineStatus'

/** Extrai os preços (centavos) dos tickers cuja cotação veio das APIs (fallback). */
function cotacoesApiDoDashboard(data: DashboardData): Map<string, number> {
  const precos = new Map<string, number>()
  for (const cotacao of data.cotacoes.values()) {
    if (cotacao.fonte === 'api' && !cotacao.usandoFallback) {
      precos.set(cotacao.ticker, cotacao.precoAtual)
    }
  }
  return precos
}

/** Persiste (best-effort) as cotações das APIs do dashboard na planilha. */
async function persistirCotacoesApiDoDashboard(
  context: RepositoryContext,
  data: DashboardData,
): Promise<void> {
  const precos = cotacoesApiDoDashboard(data)
  if (precos.size === 0) return
  try {
    await persistirESincronizarCotacoesApi(context, precos)
  } catch {
    // Best-effort (RNF04): nunca bloqueia o dashboard.
  }
}

/** Aviso exibido após uma atualização explícita de cotações. */
export interface AvisoCotacoes {
  texto: string
  tipo: 'success' | 'info' | 'error'
}

/**
 * `true` quando as integrações de cotação são apenas um **extra opcional**.
 *
 * É o caso do banco Google (planilha com `GOOGLEFINANCE`): o preço já é
 * calculado pelo próprio banco, então — desde que nenhum ativo tenha ficado sem
 * cotação — a ausência de token não deve virar aviso na tela.
 */
function integracaoOpcional(data: DashboardData | null): boolean {
  if (isModoLocal()) return false
  for (const cotacao of data?.cotacoes.values() ?? []) {
    if (cotacao.status === 'indisponivel') return false
  }
  return true
}

/**
 * Traduz o diagnóstico das APIs de cotação em uma mensagem para o usuário.
 *
 * Só faz sentido quando algum ativo de Ação/FII/BDR/ETF/Tesouro estava elegível; nesse
 * caso sempre há uma mensagem — inclusive quando a integração não está
 * configurada ou não devolveu nenhum preço.
 *
 * Exceção: quando a carteira está no Google (planilha com `GOOGLEFINANCE`) e
 * **todos** os ativos já têm preço, a integração é apenas um extra opcional — a
 * falta de token não vira aviso.
 */
function descreverAtualizacaoCotacoes(
  info: DiagnosticoCotacoesApi | null,
  /** `true` quando o banco já fornece todos os preços (integração é opcional). */
  integracaoEhOpcional: boolean,
): AvisoCotacoes | null {
  if (!info || info.total === 0) return null
  if (integracaoEhOpcional && info.semToken) return null

  const nomes = info.provedores.length > 0 ? info.provedores.join(' / ') : 'API de cotações'
  // Algumas APIs só cotam o Tesouro em planos pagos: com token e sem preço, avisa.
  const dicaTesouro =
    !info.semToken && (info.tesouroSemCotacao?.length ?? 0) > 0 && info.dicasTesouro.length > 0
      ? ` ${info.dicasTesouro.join(' ')}`
      : ''

  if (info.comCotacao === 0) {
    if (info.semToken) {
      return {
        tipo: 'error',
        texto: `A integração com a ${nomes} não está configurada. Informe o token em Configurações → Integrações para atualizar as cotações automaticamente.`,
      }
    }
    return {
      tipo: 'error',
      texto: `Não foi possível atualizar as cotações pela ${nomes} (${info.semCotacao.join(', ')}). Verifique o token em Configurações → Integrações e tente novamente.${dicaTesouro}`,
    }
  }

  if (info.semCotacao.length > 0) {
    return {
      tipo: 'info',
      texto: `Cotações atualizadas pela ${nomes}: ${info.comCotacao} de ${info.total} ativos. Sem cotação: ${info.semCotacao.join(', ')}.${dicaTesouro}`,
    }
  }

  return {
    tipo: 'info',
    texto: `Cotações da ${nomes} atualizadas para ${info.comCotacao} ${info.comCotacao === 1 ? 'ativo' : 'ativos'}.`,
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
  /** Resultado da última atualização de cotações (null quando não houve). */
  avisoCotacoes: AvisoCotacoes | null
  /**
   * Relê os dados da API e **atualiza as cotações B3 pelas APIs** (ignorando o
   * cache local). Quando a integração não devolve preço, `avisoCotacoes` traz a
   * mensagem para a UI — exceto no banco Google, onde o `GOOGLEFINANCE` já
   * fornece os preços e a integração é apenas um extra opcional.
   */
  refresh: () => Promise<void>
  /**
   * Atualização explícita de cotações com barra de progresso (botão "Atualizar"):
   * expõe `progressoAtualizacao` enquanto roda e pode ser interrompida por
   * `cancelarAtualizacao`.
   */
  atualizarComProgresso: () => Promise<void>
  /** Progresso da atualização em andamento (`null` quando não há nenhuma). */
  progressoAtualizacao: ProgressoAtualizacao | null
  /** Interrompe a atualização em andamento (nada é gravado no banco). */
  cancelarAtualizacao: () => void
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
  const [avisoCotacoes, setAvisoCotacoes] = useState<AvisoCotacoes | null>(null)
  const [progressoAtualizacao, setProgressoAtualizacao] =
    useState<ProgressoAtualizacao | null>(null)
  const autoSnapshotRef = useRef(false)
  const cancelamentoRef = useRef<AbortController | null>(null)

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
    async (
      forceRefresh: boolean,
      extras: { onProgress?: AoProgredir; signal?: AbortSignal } = {},
    ): Promise<DashboardData | null> => {
      if (forceRefresh) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      // O total de etapas só é conhecido depois de ler a carteira; guardamos o
      // maior valor recebido para fechar a barra no passo de sincronização.
      let totalEtapas = 0
      const reportar: AoProgredir | undefined = extras.onProgress
        ? (progresso) => {
            totalEtapas = Math.max(totalEtapas, progresso.total)
            extras.onProgress?.(progresso)
          }
        : undefined

      try {
        if (!workspace) {
          setError('Configure uma planilha para visualizar o dashboard.')
          return null
        }
        // Sem cache local não há o que exibir offline (RNF08). No modo local a
        // origem é o próprio navegador: "offline" não impede a leitura.
        const cache = lerDashboardDoCache(workspace.spreadsheetId)
        if (!online && !isModoLocal()) {
          if (cache) {
            setData(cache)
            setIsOffline(true)
          } else {
            setError('Sem conexão e sem dados em cache. Conecte-se para carregar a carteira.')
          }
          return null
        }
        const context = await resolveContext()
        if (!context) {
          if (cache) {
            setData(cache)
            setIsOffline(true)
          }
          return null
        }
        const resultado = await carregarDashboard(context, {
          forceRefresh,
          onProgress: reportar,
          signal: extras.signal,
        })
        setData(resultado)
        setIsOffline(false)
        // Persistência best-effort das cotações das APIs usadas como fallback:
        // grava o preço na planilha (mesmo fluxo da marcação manual).
        reportar?.({
          etapa: 'Sincronizando com o banco',
          atual: totalEtapas,
          total: totalEtapas,
        })
        await persistirCotacoesApiDoDashboard(context, resultado)
        return resultado
      } catch (loadError) {
        // Cancelamento do usuário não é falha: mantém os dados atuais e não
        // grava nada no banco (a gravação só acontece após a consulta).
        if (isAtualizacaoCancelada(loadError)) {
          setNotice('Atualização cancelada.')
          return null
        }
        const cache = workspace ? lerDashboardDoCache(workspace.spreadsheetId) : null
        if (cache) {
          setData(cache)
          setIsOffline(true)
        } else {
          setError(describeSheetsError(loadError))
        }
        return null
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
    setAvisoCotacoes(null)
    const resultado = await load(true)
    setAvisoCotacoes(
      descreverAtualizacaoCotacoes(resultado?.cotacoesApi ?? null, integracaoOpcional(resultado)),
    )
  }, [load])

  const atualizarComProgresso = useCallback(async () => {
    // Uma atualização por vez: o botão fica desabilitado e a modal aberta.
    if (cancelamentoRef.current) return
    const controller = new AbortController()
    cancelamentoRef.current = controller
    setAvisoCotacoes(null)
    setNotice(null)
    setProgressoAtualizacao({ etapa: 'Iniciando atualização', atual: 0, total: 0 })
    try {
      const resultado = await load(true, {
        signal: controller.signal,
        onProgress: setProgressoAtualizacao,
      })
      setAvisoCotacoes(
        descreverAtualizacaoCotacoes(
          resultado?.cotacoesApi ?? null,
          integracaoOpcional(resultado),
        ),
      )
    } finally {
      cancelamentoRef.current = null
      setProgressoAtualizacao(null)
    }
  }, [load])

  const cancelarAtualizacao = useCallback(() => {
    cancelamentoRef.current?.abort()
  }, [])

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
    avisoCotacoes,
    refresh,
    atualizarComProgresso,
    progressoAtualizacao,
    cancelarAtualizacao,
    registrarSnapshotManual,
  }
}
