import { calcularResumo } from '@/domain/consolidado'
import { calcularResultado } from '@/domain/resultado'
import type { Consolidado } from '@/domain/entities'
import { operacoesRepo, proventosRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { capturarSnapshot } from '@/application/dashboard'
import { registrarSnapshot } from '@/application/historico'
import { recalcularConsolidadoNoCache, syncConsolidado } from '@/application/consolidado'

/**
 * Escritas derivadas de mudanças em operações/proventos a partir do modal do
 * ativo (abas Operações/Proventos/Eventos).
 *
 * São **best-effort** (RNF04): falhas no recálculo do consolidado ou no
 * snapshot não devem impedir que o lançamento já gravado apareça na tela.
 */

/**
 * Resultado acumulado (retorno total) para o snapshot, a partir do consolidado
 * e das operações/proventos já em cache — sem rede.
 */
function lucroAcumuladoDoConsolidado(
  context: RepositoryContext,
  consolidado: readonly Consolidado[],
): number {
  const operacoes = operacoesRepo.readCache(context.spreadsheetId) ?? []
  const proventos = proventosRepo.readCache(context.spreadsheetId) ?? []
  return calcularResultado(consolidado, operacoes, proventos).retornoTotal
}

/** Registra o snapshot do dia com o resultado total (nunca lança). */
async function registrarSnapshotDoConsolidado(
  context: RepositoryContext,
  consolidado: readonly Consolidado[],
): Promise<void> {
  try {
    await registrarSnapshot(context, calcularResumo(consolidado), {
      lucroAcumulado: lucroAcumuladoDoConsolidado(context, consolidado),
    })
  } catch {
    // Snapshot é best-effort — não bloqueia a operação já salva.
  }
}

/**
 * Recalcula o `Consolidado` a partir das operações em cache e registra o
 * snapshot do dia — **sem rede**.
 *
 * Com as escritas local-first, a aba `Consolidado` e o `Historico` só são
 * gravados na origem pelo flush da sincronização. Aqui o objetivo é apenas
 * deixar a UI consistente na hora: o consolidado é recalculado no app (domínio
 * puro) e o snapshot entra na fila como qualquer outra escrita.
 */
export async function sincronizarConsolidadoESnapshot(
  context: RepositoryContext,
): Promise<void> {
  const consolidado = recalcularConsolidadoNoCache(context)
  await registrarSnapshotDoConsolidado(context, consolidado)
}

/**
 * Recalcula **e grava** a aba `Consolidado` na origem, registrando o snapshot.
 *
 * Usada pelos fluxos administrativos que rodam com `comEscritaImediata`
 * (consolidação de operações): ali a planilha precisa refletir o resultado já no
 * fim da ação, mesmo sem nenhuma mutação pendente para o flush.
 */
export async function gravarConsolidadoESnapshot(context: RepositoryContext): Promise<void> {
  const consolidado = await syncConsolidado(context)
  await registrarSnapshotDoConsolidado(context, consolidado)
}

/** Registra um snapshot no `Historico` (best-effort). */
export async function registrarSnapshotBestEffort(
  context: RepositoryContext,
): Promise<void> {
  try {
    await capturarSnapshot(context)
  } catch {
    // Snapshot é best-effort — não bloqueia o provento já salvo.
  }
}
