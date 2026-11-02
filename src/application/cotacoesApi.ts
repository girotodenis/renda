import { sincronizarConsolidadoESnapshot } from '@/application/escritasAtivo'
import { carregarConfiguracoes } from '@/application/configuracoes'
import { isCripto, isTesouroDireto, usaGoogFinance } from '@/domain/categoria'
import type {
  CotacaoMercado,
  OpcoesConsultaCotacoes,
  ResultadoCotacoes,
} from '@/domain/provedoresCotacao'
import { consolidadoRepo, operacoesRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import {
  provedorCotacoesB3,
  provedorCotacoesCripto,
  provedorCotacoesTesouro,
} from '@/infrastructure/cotacoes/registro'
import { isModoLocal } from '@/infrastructure/modoArmazenamento'
import type { Operacao } from '@/domain/entities'

/**
 * Persistência das cotações obtidas das APIs de cotação na planilha (fallback do
 * `GOOGLEFINANCE` na B3 e preço de resgate do Tesouro Direto), usando o mesmo
 * fluxo da marcação manual (RF19):
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
 * Grava os preços das APIs (centavos) na operação mais recente de cada ticker
 * (`Valor Bruto Atual`). Retorna o número de operações atualizadas.
 */
export async function persistirCotacoesApi(
  context: RepositoryContext,
  precos: ReadonlyMap<string, number>,
): Promise<number> {
  if (precos.size === 0) return 0
  // Tickers do Tesouro têm caixa mista (`Tesouro Selic 2029`): compara sem caixa.
  const precoPorTicker = new Map<string, number>()
  for (const [ticker, preco] of precos) precoPorTicker.set(ticker.trim().toUpperCase(), preco)

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
    const preco = precoPorTicker.get(ticker)
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
 * Persiste os preços das APIs e reescreve o `Consolidado` + snapshot do dia.
 * Reutiliza `sincronizarConsolidadoESnapshot` com o passo extra de gravação.
 */
export async function persistirESincronizarCotacoesApi(
  context: RepositoryContext,
  precos: ReadonlyMap<string, number>,
): Promise<void> {
  const alteradas = await persistirCotacoesApi(context, precos)
  if (alteradas === 0) return
  await sincronizarConsolidadoESnapshot(context)
}

/**
 * Resultado da atualização pontual de um ticker (botão de refresh do modal).
 *
 * - `atualizada`: preço novo (centavos) já gravado no banco quando possível;
 * - `sem-cotacao`: a integração foi consultada mas não devolveu preço;
 * - `sem-suporte`: a categoria não tem cotação automática (Renda Fixa).
 */
export type ResultadoCotacaoTicker =
  | { status: 'atualizada'; preco: number; precoAbertura: number | null }
  | { status: 'sem-cotacao'; mensagem: string }
  | { status: 'sem-suporte'; mensagem: string }

/** Operação mais recente do ticker (define categoria e vencimento). */
function operacaoMaisRecente(
  operacoes: readonly Operacao[],
  ticker: string,
): Operacao | null {
  const alvo = ticker.trim().toUpperCase()
  let recente: Operacao | null = null
  for (const operacao of operacoes) {
    if (operacao.ticker.trim().toUpperCase() !== alvo) continue
    if (!recente || eMaisRecente(operacao, recente)) recente = operacao
  }
  return recente
}

/** Cotação de um ticker no resultado, comparando sem diferenciar caixa. */
function buscarCotacao(
  cotacoes: ReadonlyMap<string, CotacaoMercado>,
  ticker: string,
): CotacaoMercado | null {
  const alvo = ticker.trim().toUpperCase()
  for (const [chave, cotacao] of cotacoes) {
    if (chave.trim().toUpperCase() === alvo) return cotacao
  }
  return null
}

/**
 * Atualiza **somente** a cotação de um ticker (botão de refresh do modal do
 * ativo), usando a mesma cadeia de provedores da atualização geral.
 *
 * A categoria (e o vencimento, no Tesouro Direto) vem da operação mais recente
 * do ticker; sem operação, cai para a linha do `Consolidado` em cache. O preço
 * encontrado é persistido pelo mesmo fluxo da marcação manual (operação mais
 * recente + `Consolidado` + snapshot), de forma **best-effort**: se a gravação
 * falhar, o valor novo ainda é devolvido para a tela.
 */
export async function atualizarCotacaoTicker(
  context: RepositoryContext,
  ticker: string,
): Promise<ResultadoCotacaoTicker> {
  const alvo = ticker.trim()
  if (alvo.length === 0) {
    return { status: 'sem-cotacao', mensagem: 'Ticker inválido para atualizar a cotação.' }
  }

  const operacoes = await operacoesRepo.list(context)
  const operacao = operacaoMaisRecente(operacoes, alvo)
  const linhaConsolidado = consolidadoRepo
    .readCache(context.spreadsheetId)
    ?.find((linha) => linha.ticker.trim().toUpperCase() === alvo.toUpperCase())
  const categoria = operacao?.categoria ?? linhaConsolidado?.categoria

  if (!categoria) {
    return {
      status: 'sem-cotacao',
      mensagem: `Nenhuma posição de ${alvo} encontrada para atualizar a cotação.`,
    }
  }

  if (!usaGoogFinance(categoria) && !isCripto(categoria) && !isTesouroDireto(categoria)) {
    return {
      status: 'sem-suporte',
      mensagem: `${alvo} não tem cotação automática — use o valor manual.`,
    }
  }

  const config = await carregarConfiguracoes(context)
  const opcoes: OpcoesConsultaCotacoes = {
    tokens: config.tokens,
    // O sentinela `local` não é token OAuth: o modo local não consulta a
    // planilha de cotações (as APIs de cotação seguem funcionando).
    accessToken: isModoLocal() ? undefined : context.accessToken,
    forceRefresh: true,
  }

  let resultado: ResultadoCotacoes
  if (isTesouroDireto(categoria)) {
    resultado = await provedorCotacoesTesouro.atualizar(
      [{ ticker: alvo, vencimento: operacao?.vencimento ?? null }],
      opcoes,
    )
  } else if (isCripto(categoria)) {
    resultado = await provedorCotacoesCripto.atualizar([alvo], opcoes)
  } else {
    resultado = await provedorCotacoesB3.atualizar([alvo], opcoes)
  }

  const cotacao = buscarCotacao(resultado.cotacoes, alvo)
  if (!cotacao) {
    return {
      status: 'sem-cotacao',
      mensagem: resultado.semToken
        ? 'Nenhuma integração de cotações está configurada. Informe o token em Configurações → Integrações.'
        : `A integração não devolveu cotação de ${alvo} agora. Tente novamente em instantes.`,
    }
  }

  try {
    await persistirESincronizarCotacoesApi(context, new Map([[alvo, cotacao.preco]]))
  } catch {
    // Best-effort (RNF04): o valor novo aparece na tela mesmo sem gravar.
  }

  return { status: 'atualizada', preco: cotacao.preco, precoAbertura: cotacao.precoAbertura }
}
