import type { ResumoCarteira } from '@/domain/consolidado'
import { toISO } from '@/domain/dates'
import { historicoRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import type { Snapshot } from '@/domain/entities'

/**
 * Snapshot do patrimônio na aba `Historico` (Seção 2 / RF18).
 *
 * A gravação é **idempotente por dia**: se já existir uma linha para a data,
 * ela é substituída (nunca duplica). O snapshot é best-effort — falhas de rede
 * não devem bloquear o fluxo do app (RNF04).
 */

/** Monta o snapshot do resumo patrimonial para uma data (ISO `YYYY-MM-DD`). */
export function snapshotDoResumo(
  resumo: ResumoCarteira,
  data: string = toISO(new Date()),
): Snapshot {
  return {
    data,
    patrimonioTotal: resumo.patrimonioTotal,
    totalInvestido: resumo.totalInvestido,
    lucroAcumulado: resumo.lucroTotal,
  }
}

/** Insere/substitui o snapshot de mesma data, mantendo o histórico ordenado. */
export function upsertHistorico(
  historico: readonly Snapshot[],
  snapshot: Snapshot,
): Snapshot[] {
  const index = historico.findIndex((item) => item.data === snapshot.data)
  const proximo =
    index >= 0
      ? historico.map((item, posicao) => (posicao === index ? snapshot : item))
      : [...historico, snapshot]
  return [...proximo].sort((a, b) => a.data.localeCompare(b.data))
}

/** Snapshot mais recente do histórico (`null` quando vazio). */
export function snapshotMaisRecente(historico: readonly Snapshot[]): Snapshot | null {
  if (historico.length === 0) return null
  return historico.reduce((maisRecente, item) =>
    item.data > maisRecente.data ? item : maisRecente,
  )
}

/** `true` quando já existe um snapshot para a data informada (padrão: hoje). */
export function jaTemSnapshotDeHoje(
  historico: readonly Snapshot[],
  data: string = toISO(new Date()),
): boolean {
  return historico.some((item) => item.data === data)
}

/**
 * Grava (ou atualiza) o snapshot do dia a partir do resumo da carteira.
 *
 * Relê a aba para não sobrescrever snapshots de outras datas e reescreve a
 * região de dados de forma segura (preserva o cabeçalho).
 */
export async function registrarSnapshot(
  context: RepositoryContext,
  resumo: ResumoCarteira,
  options: { data?: string } = {},
): Promise<Snapshot> {
  const snapshot = snapshotDoResumo(resumo, options.data)
  const existentes = await historicoRepo.refresh(context)
  await historicoRepo.replaceAll(context, upsertHistorico(existentes, snapshot))
  return snapshot
}
