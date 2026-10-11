import {
  atualizarCategoriaDeMetas,
  atualizarCategoriaDeOperacoes,
  atualizarCategoriaDeProventos,
} from '@/domain/trocaCategoria'
import { metasRepo, operacoesRepo, proventosRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import type { CategoriaAtivo, Operacao } from '@/domain/entities'

/**
 * Casos de uso de escrita sobre as abas que guardam categoria por ticker
 * (`Operacoes`, `Proventos` e `Metas_Rebalanceamento`).
 *
 * A leitura/escrita passa sempre pelo repositório (cache-first e re-escrita
 * segura da aba). O recálculo do `Consolidado` e o snapshot do `Historico`
 * ficam a cargo de quem chama (best-effort — RNF04).
 */

/** Quantidade de registros atualizados por aba na troca de categoria. */
export interface ResultadoTrocaCategoria {
  operacoes: number
  proventos: number
  metas: number
}

/**
 * Altera a categoria de **todos** os registros de um ticker (RF10 — troca de
 * categoria pelo modal do ativo): operações, proventos e as metas do ticker
 * (linhas de classe do rebalanceamento são preservadas).
 *
 * Relê cada aba direto da API antes de gravar (evita sobrescrever linhas
 * alteradas fora do app) e só reescreve as abas que tiveram mudanças. Retorna a
 * quantidade de registros atualizados por aba.
 */
export async function alterarCategoriaDoTicker(
  context: RepositoryContext,
  ticker: string,
  categoria: CategoriaAtivo,
): Promise<ResultadoTrocaCategoria> {
  const resultado: ResultadoTrocaCategoria = { operacoes: 0, proventos: 0, metas: 0 }

  const operacoes = await operacoesRepo.refresh(context)
  const trocaOperacoes = atualizarCategoriaDeOperacoes(operacoes, ticker, categoria)
  if (trocaOperacoes.atualizadas > 0) {
    await operacoesRepo.replaceAll(context, trocaOperacoes.operacoes)
    resultado.operacoes = trocaOperacoes.atualizadas
  }

  const proventos = await proventosRepo.refresh(context)
  const trocaProventos = atualizarCategoriaDeProventos(proventos, ticker, categoria)
  if (trocaProventos.atualizadas > 0) {
    await proventosRepo.replaceAll(context, trocaProventos.proventos)
    resultado.proventos = trocaProventos.atualizadas
  }

  const metas = await metasRepo.refresh(context)
  const trocaMetas = atualizarCategoriaDeMetas(metas, ticker, categoria)
  if (trocaMetas.atualizadas > 0) {
    await metasRepo.replaceAll(context, trocaMetas.metas)
    resultado.metas = trocaMetas.atualizadas
  }

  return resultado
}

/** Ordena operações da mais recente para a mais antiga (data, depois id). */
function porMaisRecente(a: Operacao, b: Operacao): number {
  return b.data.localeCompare(a.data) || b.id.localeCompare(a.id)
}

/** Resultado da atualização manual do valor atual de um ativo. */
export interface ResultadoValorManual {
  /** Ticker do ativo (como gravado na operação). */
  ticker: string
  /** Valor atual informado pelo usuário, em **centavos**. */
  valorBrutoAtual: number
  /** Operação que passou a carregar a marcação manual. */
  operacaoId: string
}

/**
 * Atualiza a **marcação manual do valor atual** de um ativo de Renda Fixa ou
 * Tesouro Direto (RF19).
 *
 * A marcação é gravada na operação mais recente do ticker (coluna
 * `Valor Bruto Atual`), de onde é lida por `precosManuaisDeOperacoes`. Assim, o
 * valor informado pelo usuário é usado sempre que a integração não retornar
 * cotação — e **não é apagado** por falhas de integração (RNF04), pois a
 * sincronização do `Consolidado` nunca reescreve a aba `Operacoes`.
 *
 * Lança erro quando não há operação do ticker (não há onde gravar a marcação).
 */
export async function definirValorManualTicker(
  context: RepositoryContext,
  ticker: string,
  valorBrutoAtual: number,
): Promise<ResultadoValorManual> {
  const alvo = ticker.trim().toUpperCase()
  const operacoes = await operacoesRepo.refresh(context)
  const doTicker = operacoes
    .filter((operacao) => operacao.ticker.trim().toUpperCase() === alvo)
    .sort(porMaisRecente)

  const recente = doTicker[0]
  if (!recente) {
    throw new Error(`Nenhuma operação encontrada para ${ticker}.`)
  }

  await operacoesRepo.update(context, { ...recente, valorBrutoAtual })
  return { ticker: recente.ticker, valorBrutoAtual, operacaoId: recente.id }
}
