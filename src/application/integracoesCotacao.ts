import type { CategoriaAtivo } from '@/domain/entities'
import type { IntegracaoCotacao } from '@/domain/provedoresCotacao'
import { integracoesCotacao, provedorListaTickers } from '@/infrastructure/cotacoes/registro'

/**
 * Casos de uso das integrações de cotação expostos à UI, que assim não
 * depende de nenhuma API concreta (os adaptadores vivem na infraestrutura).
 */

/** Dados de uma integração exibidos em Configurações → Integrações. */
export type IntegracaoCotacaoInfo = Pick<IntegracaoCotacao, 'id' | 'nome' | 'site' | 'exigeToken'>

/** Integrações de cotação registradas, em ordem de prioridade. */
export function listarIntegracoesCotacao(): IntegracaoCotacaoInfo[] {
  return integracoesCotacao.map(({ id, nome, site, exigeToken }) => ({ id, nome, site, exigeToken }))
}

/** Limpa o cache local de todas as integrações (ex.: após trocar tokens). */
export function limparCachesCotacao(): void {
  for (const integracao of integracoesCotacao) integracao.limparCache()
}

/** Tickers negociados da categoria (autocomplete); `[]` quando indisponível. */
export function listarTickersMercado(categoria: CategoriaAtivo): Promise<string[]> {
  return provedorListaTickers.listar(categoria)
}
