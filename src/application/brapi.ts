import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'
import { operacoesRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import type { Operacao } from '@/domain/entities'

/**
 * Persistência das cotações B3 obtidas via Brapi na planilha (fallback do
 * `GOOGLEFINANCE`), usando o mesmo fluxo da marcação manual (RF19):
 *
 * 1. grava o preço em `Operacao.valorBrutoAtual` da operação mais recente de
 *    cada ticker;
 * 2. reescreve o `Consolidado`, que passa a gravar o valor estático em
 *    `Preço Atual`;
 * 3. registra o snapshot do dia.
 *
 * Tudo é **best-effort** (RNF04): falhas não bloqueiam o dashboard. Apenas
 * tickers cujo valor mudou são regravados, evitando escritas redundantes.
 */

/** `true` quando `candidato` é mais recente que `atual` (data, depois id). */
function eMaisRecente(candidato: Operacao, atual: Operacao): boolean {
  if (candidato.data !== atual.data) return candidato.data > atual.data
  return candidato.id > atual.id
}

/**
 * Grava os preços Brapi (centavos) na operação mais recente de cada ticker
 * (`Valor Bruto Atual`). Retorna o número de operações atualizadas.
 */
export async function persistirCotacoesBrapi(
  context: RepositoryContext,
  precos: ReadonlyMap<string, number>,
): Promise<number> {
  if (precos.size === 0) return 0

  const operacoes = await operacoesRepo.refresh(context)
  const recentePorTicker = new Map<string, Operacao>()
  for (const operacao of operacoes) {
    const ticker = operacao.ticker.trim().toUpperCase()
    if (ticker.length === 0) continue
    const atual = recentePorTicker.get(ticker)
    if (!atual || eMaisRecente(operacao, atual)) recentePorTicker.set(ticker, operacao)
  }

  let alteradas = 0
  const proximas = operacoes.map((operacao) => {
    const ticker = operacao.ticker.trim().toUpperCase()
    const preco = precos.get(ticker)
    if (preco === undefined) return operacao
    const recente = recentePorTicker.get(ticker)
    if (!recente || recente.id !== operacao.id) return operacao
    if (operacao.valorBrutoAtual === preco) return operacao
    alteradas += 1
    return { ...operacao, valorBrutoAtual: preco }
  })

  if (alteradas === 0) return 0
  await operacoesRepo.replaceAll(context, proximas)
  return alteradas
}

/**
 * Persiste os preços Brapi e reescreve o `Consolidado` + snapshot do dia.
 * Reutiliza `sincronizarConsolidadoESnapshot` com o passo extra de gravação.
 */
export async function persistirESincronizarCotacoesBrapi(
  context: RepositoryContext,
  precos: ReadonlyMap<string, number>,
): Promise<void> {
  const alteradas = await persistirCotacoesBrapi(context, precos)
  if (alteradas === 0) return
  await sincronizarConsolidadoESnapshot(context)
}
