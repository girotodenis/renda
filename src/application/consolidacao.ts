import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'
import {
  analisarPendencias,
  calcularConsolidacao,
  contarProventosComDataInvalida,
  verificarInvariantes,
} from '@/domain/consolidacao'
import type {
  AlvoConsolidacao,
  Divergencia,
  PendenciaConsolidacao,
  ResumoConsolidacao,
  ResultadoConsolidacaoCalculada,
} from '@/domain/consolidacao'
import type { Operacao, Provento } from '@/domain/entities'
import { newId } from '@/domain/ids'
import type { RepositoryContext } from '@/domain/repositories/ports'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import { isOnline } from '@/infrastructure/outbox'
import { operacoesRepo, proventosRepo } from '@/infrastructure/repositories'
import { executarEmLote } from '@/infrastructure/sheets/gatewayRouter'

/**
 * Caso de uso da página **Consolidação** (`PLANO_CONSOLIDACAO.md` §4).
 *
 * Orquestra a leitura (cache-first na página, sempre relida da API antes de
 * gravar), o cálculo puro do domínio, a verificação de invariantes bloqueante e
 * a gravação das duas abas em lote. Nada é consolidado automaticamente: as
 * funções só agem quando chamadas pela UI.
 */

/** Painel exibido pela página (pendências + listas usadas na simulação). */
export interface PainelConsolidacao {
  pendencias: PendenciaConsolidacao[]
  operacoes: Operacao[]
  proventos: Provento[]
  /** Proventos sem `dataPagamento` válida (ficam fora da consolidação). */
  proventosComDataInvalida: number
  anoCorrente: number
}

/** Resultado de uma consolidação executada. */
export interface ResultadoExecucaoConsolidacao {
  /** Quantidade de linhas apagadas (operações + proventos). */
  absorvidas: number
  /** Quantidade de linhas criadas (operações + proventos). */
  geradas: number
  resumo: ResumoConsolidacao
}

/**
 * Dependências injetáveis (testes). Os valores padrão apontam para os módulos
 * reais de infraestrutura.
 */
export interface ConsolidacaoDependencies {
  listOperacoes: (context: RepositoryContext, forceRefresh: boolean) => Promise<Operacao[]>
  listProventos: (context: RepositoryContext, forceRefresh: boolean) => Promise<Provento[]>
  refreshOperacoes: (context: RepositoryContext) => Promise<Operacao[]>
  refreshProventos: (context: RepositoryContext) => Promise<Provento[]>
  replaceOperacoes: (context: RepositoryContext, operacoes: readonly Operacao[]) => Promise<void>
  replaceProventos: (context: RepositoryContext, proventos: readonly Provento[]) => Promise<void>
  executarEmLote: <T>(context: RepositoryContext, fn: () => Promise<T>) => Promise<T>
  /** Recalcula o `Consolidado` e registra snapshot (best-effort). */
  sincronizar: (context: RepositoryContext) => Promise<void>
  isOnline: () => boolean
  isModoLocal: () => boolean
  agora: () => Date
  novoId: () => string
  calcularConsolidacao: typeof calcularConsolidacao
  verificarInvariantes: typeof verificarInvariantes
}

const defaultDeps: ConsolidacaoDependencies = {
  listOperacoes: (context, forceRefresh) =>
    operacoesRepo.list(context, { forceRefresh }),
  listProventos: (context, forceRefresh) =>
    proventosRepo.list(context, { forceRefresh }),
  refreshOperacoes: (context) => operacoesRepo.refresh(context),
  refreshProventos: (context) => proventosRepo.refresh(context),
  replaceOperacoes: (context, operacoes) => operacoesRepo.replaceAll(context, operacoes),
  replaceProventos: (context, proventos) => proventosRepo.replaceAll(context, proventos),
  executarEmLote: (context, fn) =>
    executarEmLote(context.accessToken, context.spreadsheetId, fn),
  sincronizar: sincronizarConsolidadoESnapshot,
  isOnline,
  isModoLocal,
  agora: () => new Date(),
  novoId: newId,
  calcularConsolidacao,
  verificarInvariantes,
}

export interface CarregarPainelOptions {
  /** Ignora o cache e relê as abas da API (botão "Atualizar"). */
  forceRefresh?: boolean
  deps?: Partial<ConsolidacaoDependencies>
}

export interface ExecutarConsolidacaoOptions {
  deps?: Partial<ConsolidacaoDependencies>
}

function resolverDeps(deps?: Partial<ConsolidacaoDependencies>): ConsolidacaoDependencies {
  return { ...defaultDeps, ...deps }
}

/**
 * Carrega as pendências da página (leitura cache-first, inclusive offline).
 *
 * Devolve também as listas cruas de operações/proventos: o modal de
 * confirmação simula a consolidação com os mesmos dados exibidos, sem nova
 * leitura.
 */
export async function carregarPainelConsolidacao(
  context: RepositoryContext,
  opcoes: CarregarPainelOptions = {},
): Promise<PainelConsolidacao> {
  const deps = resolverDeps(opcoes.deps)
  const forceRefresh = opcoes.forceRefresh ?? false
  const [operacoes, proventos] = await Promise.all([
    deps.listOperacoes(context, forceRefresh),
    deps.listProventos(context, forceRefresh),
  ])
  const anoCorrente = deps.agora().getFullYear()

  return {
    pendencias: analisarPendencias(operacoes, proventos, anoCorrente),
    operacoes,
    proventos,
    proventosComDataInvalida: contarProventosComDataInvalida(proventos),
    anoCorrente,
  }
}

/**
 * Simula uma consolidação com os dados já carregados (modal de confirmação).
 *
 * Não grava nada: devolve o resultado calculado ou `{ erro }` para exibir o
 * motivo do bloqueio.
 */
export function simularConsolidacao(
  alvo: AlvoConsolidacao,
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  opcoes: { novoId?: () => string; deps?: Partial<ConsolidacaoDependencies> } = {},
): ResultadoConsolidacaoCalculada | { erro: string } {
  const deps = resolverDeps(opcoes.deps)
  const ids = opcoes.novoId ?? criarIdDeSimulacao()
  return deps.calcularConsolidacao(alvo, operacoes, proventos, { novoId: ids })
}

/** IDs estáveis de simulação (nunca gravados). */
function criarIdDeSimulacao(): () => string {
  let contador = 0
  return () => {
    contador += 1
    return `simulacao-${contador}`
  }
}

function descreverDivergencias(divergencias: readonly Divergencia[]): string {
  return divergencias
    .slice(0, 3)
    .map(
      (divergencia) =>
        `${divergencia.metrica}: esperado ${divergencia.esperado}, obtido ${divergencia.obtido}`,
    )
    .join('; ')
}

/**
 * Executa a consolidação do escopo escolhido (§4).
 *
 * Fluxo: guardas (online e ano anterior ao corrente) → relê as abas da API →
 * calcula → verifica invariantes (aborta se divergir) → grava as duas abas em
 * lote → recalcula o `Consolidado`/snapshot (best-effort).
 */
export async function executarConsolidacao(
  context: RepositoryContext,
  alvo: AlvoConsolidacao,
  opcoes: ExecutarConsolidacaoOptions = {},
): Promise<ResultadoExecucaoConsolidacao> {
  const deps = resolverDeps(opcoes.deps)

  if (!deps.isModoLocal() && !deps.isOnline()) {
    throw new Error(
      'Conecte-se à internet para consolidar: a gravação precisa reler as abas atuais do banco.',
    )
  }
  if (alvo.tipo === 'ticker-ano' && alvo.ano >= deps.agora().getFullYear()) {
    throw new Error('Só é possível consolidar anos anteriores ao ano corrente.')
  }

  // Relê da API: as linhas apagadas precisam ser exatamente as da planilha.
  const [operacoes, proventos] = await Promise.all([
    deps.refreshOperacoes(context),
    deps.refreshProventos(context),
  ])

  const resultado = deps.calcularConsolidacao(alvo, operacoes, proventos, {
    novoId: deps.novoId,
  })
  if ('erro' in resultado) throw new Error(resultado.erro)

  const divergencias = deps.verificarInvariantes(
    { operacoes, proventos },
    { operacoes: resultado.operacoes, proventos: resultado.proventos },
  )
  if (divergencias.length > 0) {
    throw new Error(
      `Consolidação cancelada: a verificação de integridade falhou (${descreverDivergencias(divergencias)}). Nada foi gravado.`,
    )
  }

  const mudouOperacoes = resultado.absorvidas.operacoes.length > 0
  const mudouProventos = resultado.absorvidas.proventos.length > 0

  await deps.executarEmLote(context, async () => {
    if (mudouOperacoes) await deps.replaceOperacoes(context, resultado.operacoes)
    if (mudouProventos) await deps.replaceProventos(context, resultado.proventos)
  })

  // Best-effort: o `sincronizarConsolidadoESnapshot` já trata as próprias falhas.
  await deps.sincronizar(context)

  return {
    absorvidas:
      resultado.absorvidas.operacoes.length + resultado.absorvidas.proventos.length,
    geradas: resultado.geradas.operacoes.length + resultado.geradas.proventos.length,
    resumo: resultado.resumo,
  }
}
