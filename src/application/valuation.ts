import { valuationRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { ensureRequiredSheets } from '@/services/sheets'
import type { Valuation } from '@/types/domain'

/**
 * Casos de uso de escrita da análise de valuation (aba `Valuation`).
 *
 * A leitura/escrita passa pelo repositório (cache-first). Antes de gravar,
 * `ensureRequiredSheets` garante que a aba exista — criando-a em planilhas mais
 * antigas que ainda não a possuam (idempotente).
 */

/** `true` quando a análise não tem nenhum dado relevante (pode ser removida). */
export function valuationVazia(valuation: Valuation): boolean {
  return (
    valuation.precoTeto === null &&
    valuation.margemSeguranca === null &&
    valuation.anotacoes.trim().length === 0
  )
}

/**
 * Salva (ou remove, quando vazia) a análise de valuation de um ticker.
 *
 * O ticker é a chave natural da aba: se já existir uma linha para ele, ela é
 * atualizada; caso contrário, uma nova linha é acrescentada. Uma análise sem
 * preço teto, margem e anotações remove a linha existente.
 */
export async function salvarValuation(
  context: RepositoryContext,
  valuation: Valuation,
): Promise<void> {
  await ensureRequiredSheets(context.accessToken, context.spreadsheetId)

  const alvo = valuation.ticker.trim().toUpperCase()
  const linhas = await valuationRepo.refresh(context)
  const index = linhas.findIndex((linha) => linha.ticker.trim().toUpperCase() === alvo)

  if (valuationVazia(valuation)) {
    if (index >= 0) {
      await valuationRepo.replaceAll(context, linhas.filter((_, i) => i !== index))
    }
    return
  }

  const gravado: Valuation = { ...valuation, ticker: alvo }
  if (index >= 0) {
    const proximas = linhas.slice()
    proximas[index] = gravado
    await valuationRepo.replaceAll(context, proximas)
  } else {
    await valuationRepo.append(context, gravado)
  }
}
