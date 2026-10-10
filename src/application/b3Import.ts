import type { B3ParseResult } from '@/lib/b3Import'
import { operacoesRepo, proventosRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import type { Operacao, Provento } from '@/types/domain'

/**
 * Grava os dados analisados dos extratos B3 nas abas `Proventos` e `Operacoes`
 * (RF23, Etapa 8).
 *
 * Deduplicação: os itens importados possuem **ID determinístico** (hash do
 * registro — ver `lib/b3Import`). Reimportar o mesmo arquivo gera os mesmos
 * IDs, portanto nada é duplicado. Lançamentos manuais (UUID) nunca colidem.
 *
 * Estratégia de escrita: relê as abas atuais e reescreve a lista completa em
 * uma única operação (`replaceAll`), evitando N chamadas de `append`.
 */

export interface B3ImportStats {
  proventosNovos: number
  operacoesNovas: number
  duplicadosIgnorados: number
}

interface ComId {
  id: string
}

function deduplicar<T extends ComId>(itens: readonly T[], existentes: ReadonlySet<string>): T[] {
  const vistos = new Set<string>()
  const resultado: T[] = []
  for (const item of itens) {
    if (existentes.has(item.id) || vistos.has(item.id)) continue
    vistos.add(item.id)
    resultado.push(item)
  }
  return resultado
}

export async function importarExtratoB3(
  context: RepositoryContext,
  resultado: B3ParseResult,
): Promise<B3ImportStats> {
  // Relê a API para deduplicar com segurança (evita sobrescrever linhas novas).
  const proventosAtuais: Provento[] = await proventosRepo.refresh(context)
  const operacoesAtuais: Operacao[] = await operacoesRepo.refresh(context)

  const idsProventos = new Set(proventosAtuais.map((provento) => provento.id))
  const idsOperacoes = new Set(operacoesAtuais.map((operacao) => operacao.id))

  const novosProventos = deduplicar(resultado.proventos, idsProventos)
  const novasOperacoes = deduplicar(resultado.operacoes, idsOperacoes)

  if (novosProventos.length > 0) {
    await proventosRepo.replaceAll(context, [...proventosAtuais, ...novosProventos])
  }
  if (novasOperacoes.length > 0) {
    await operacoesRepo.replaceAll(context, [...operacoesAtuais, ...novasOperacoes])
  }

  return {
    proventosNovos: novosProventos.length,
    operacoesNovas: novasOperacoes.length,
    duplicadosIgnorados:
      resultado.proventos.length -
      novosProventos.length +
      (resultado.operacoes.length - novasOperacoes.length),
  }
}
