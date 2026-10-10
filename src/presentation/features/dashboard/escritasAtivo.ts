import { calcularResumo } from '@/lib/consolidado'
import { consolidadoRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { capturarSnapshot } from '@/services/dashboard'
import { registrarSnapshot } from '@/services/historico'
import { syncConsolidado } from '@/services/consolidado'

/**
 * Escritas derivadas de mudanças em operações/proventos a partir do modal do
 * ativo (abas Operações/Proventos/Eventos).
 *
 * São **best-effort** (RNF04): falhas no recálculo do consolidado ou no
 * snapshot não devem impedir que o lançamento já gravado apareça na tela.
 */

/**
 * Recalcula a aba `Consolidado` a partir das operações atuais e registra um
 * snapshot no `Historico`. Em caso de falha no recálculo, invalida o cache para
 * o próximo acesso recalcular.
 */
export async function sincronizarConsolidadoESnapshot(
  context: RepositoryContext,
): Promise<void> {
  try {
    const consolidado = await syncConsolidado(context)
    try {
      await registrarSnapshot(context, calcularResumo(consolidado))
    } catch {
      // Snapshot é best-effort — não bloqueia a operação já salva.
    }
  } catch {
    consolidadoRepo.invalidateCache(context.spreadsheetId)
  }
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
