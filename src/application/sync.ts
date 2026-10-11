import { syncConsolidado } from '@/application/consolidado'
import type { RepositoryContext } from '@/domain/repositories/ports'
import type { SheetName } from '@/domain/sheetsSchema'
import { list, remove } from '@/infrastructure/outbox'
import type { Mutation } from '@/infrastructure/outbox'
import { prefetchAllSheets, rawRepositories, replayMutation } from '@/infrastructure/repositories'

/**
 * Sincronização da fila offline (Fase 2 do plano PWA).
 *
 * Reaplica, em ordem FIFO, as mutações pendentes do outbox na planilha usando
 * os repositórios **crus** (sem o decorador offline) — assim uma falha de rede
 * durante o replay interrompe o processo e mantém o item na fila, sem risco de
 * reenfileiramento em loop. Ao final, se algo foi aplicado, recalcula a aba
 * derivada `Consolidado` **uma vez** e refresca o cache de todas as abas.
 */

/** Resultado de uma tentativa de sincronização. */
export interface SyncResult {
  /**
   * Quantidade de mutações resolvidas com sucesso (aplicadas na planilha ou
   * puladas por já existirem — em ambos os casos saem da fila).
   */
  aplicadas: number
  /** Quantidade de mutações que permanecem na fila após a tentativa. */
  pendentes: number
  /** Primeira falha não-recuperável encontrada (403/500/401), se houver. */
  erro?: string
}

/**
 * Dependências injetáveis da sincronização (testes). Os valores padrão apontam
 * para os módulos reais de infraestrutura.
 */
export interface SyncDependencies {
  /** Lê a fila em ordem FIFO. */
  listMutations: () => Mutation[]
  /** Remove uma mutação da fila (após sucesso). */
  removeMutation: (id: string) => void
  /** Aplica a mutação no repositório cru correspondente. */
  replayMutation: (context: RepositoryContext, mutation: Mutation) => Promise<void>
  /**
   * Verifica se um `append` já tem registro com o mesmo ID na aba
   * (idempotência). Retorna `true` para pular a reaplicação.
   */
  appendJaExiste: (
    context: RepositoryContext,
    sheet: SheetName,
    entity: unknown,
  ) => Promise<boolean>
  /** Recalcula a aba derivada `Consolidado`. */
  syncConsolidado: (context: RepositoryContext) => Promise<unknown>
  /** Refresca o cache de todas as abas. */
  prefetchAllSheets: (context: RepositoryContext) => Promise<unknown>
}

/** Opções da sincronização. */
export interface SyncOptions {
  /**
   * Callback para obter/renovar o token em caso de 401. A UI (`AuthProvider`)
   * injeta `ensureAccessToken` aqui. Se omitido, um 401 interrompe o flush.
   */
  obterToken?: () => Promise<string | null>
  /** Dependências injetáveis (testes). */
  deps?: Partial<SyncDependencies>
}

const defaultDeps: SyncDependencies = {
  listMutations: list,
  removeMutation: remove,
  replayMutation,
  appendJaExiste: async (context, sheet, entity) => {
    const repo = rawRepositories[sheet]
    const id = repo.idOf?.(entity)
    if (!id) return false
    const existentes = await repo.refresh(context)
    return existentes.some((linha) => repo.idOf?.(linha) === id)
  },
  syncConsolidado: (context) => syncConsolidado(context),
  prefetchAllSheets,
}

/** Extrai o status HTTP de um erro (`SheetsApiError` ou objeto com `status`). */
function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Falha ao sincronizar alterações pendentes.'
}

/** Aplica uma mutação, pulando `append` duplicado (idempotência por ID). */
async function aplicar(
  deps: SyncDependencies,
  context: RepositoryContext,
  mutation: Mutation,
): Promise<void> {
  if (mutation.kind === 'append') {
    const jaExiste = await deps.appendJaExiste(context, mutation.sheet, mutation.entity)
    if (jaExiste) return
  }
  await deps.replayMutation(context, mutation)
}

/**
 * Reaplica as mutações pendentes do outbox na planilha, em ordem FIFO.
 *
 * Regras por erro:
 * - sucesso → remove o item e continua;
 * - rede/quota (`status` 0 ou 429) → interrompe e mantém o item;
 * - 401 → renova o token via `obterToken` e re-tenta **uma** vez; se falhar,
 *   interrompe;
 * - demais erros (403/500) → mantém o item, registra o erro e continua.
 */
export async function sincronizarPendentes(
  context: RepositoryContext,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const deps = { ...defaultDeps, ...options.deps }
  const resultado: SyncResult = { aplicadas: 0, pendentes: 0 }
  // Token efetivo durante o flush: atualizado quando `obterToken` renova em 401.
  let accessTokenAtual = context.accessToken

  const fila = deps.listMutations()
  if (fila.length === 0) {
    resultado.pendentes = 0
    return resultado
  }

  for (const mutation of fila) {
    try {
      await aplicar(deps, { ...context, accessToken: accessTokenAtual }, mutation)
      deps.removeMutation(mutation.id)
      resultado.aplicadas += 1
      continue
    } catch (error) {
      const status = errorStatus(error)

      if (status === 401) {
        if (!options.obterToken) {
          resultado.erro = 'Sessão expirada. Faça login novamente.'
          resultado.pendentes = deps.listMutations().length
          return resultado
        }
        const novoToken = await options.obterToken()
        if (!novoToken) {
          resultado.erro = 'Sessão expirada. Faça login novamente.'
          resultado.pendentes = deps.listMutations().length
          return resultado
        }
        accessTokenAtual = novoToken
        try {
          await aplicar(deps, { ...context, accessToken: accessTokenAtual }, mutation)
          deps.removeMutation(mutation.id)
          resultado.aplicadas += 1
          continue
        } catch {
          resultado.erro = 'Falha ao reaplicar a alteração após renovar o token.'
          resultado.pendentes = deps.listMutations().length
          return resultado
        }
      }

      if (status === 0 || status === 429) {
        // Rede/quota: interrompe mantendo o item (será retomado no próximo ciclo).
        resultado.pendentes = deps.listMutations().length
        return resultado
      }

      // Demais erros (403/500): mantém o item e registra o erro, continuando.
      resultado.erro = resultado.erro ?? describeError(error)
    }
  }

  // Pós-flush: recalcula o Consolidado uma única vez e refresca o cache.
  if (resultado.aplicadas > 0) {
    const contextAtual = { ...context, accessToken: accessTokenAtual }
    try {
      await deps.syncConsolidado(contextAtual)
      await deps.prefetchAllSheets(contextAtual)
    } catch (error) {
      // Best-effort: as mutações já foram aplicadas; a falha aqui só atrasa o
      // recálculo do derivado, que será refeito no próximo acesso/ciclo.
      resultado.erro = resultado.erro ?? describeError(error)
    }
  }

  resultado.pendentes = deps.listMutations().length
  return resultado
}
