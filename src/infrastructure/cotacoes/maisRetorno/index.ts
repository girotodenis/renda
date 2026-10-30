import type { IntegracaoCotacao } from '@/domain/provedoresCotacao'
import {
  atualizarCotacoesMaisRetorno,
  clearMaisRetornoCache,
  lerCotacaoCache,
} from '@/infrastructure/cotacoes/maisRetorno/cotacoesB3'
import {
  atualizarCotacoesTesouroMaisRetorno,
  clearMaisRetornoTesouroCache,
  lerCotacoesTesouroCache,
} from '@/infrastructure/cotacoes/maisRetorno/tesouro'
import {
  clearMaisRetornoSetorCache,
  provedorSetoresMaisRetorno,
} from '@/infrastructure/cotacoes/maisRetorno/assetInfo'

export const MAIS_RETORNO_ID = 'maisretorno'

/**
 * Adaptador da **Mais Retorno** (`data.maisretorno.com`) para as portas de
 * cotação do domínio.
 *
 * Não oferece lista de tickers: a API não tem endpoint de listagem por
 * categoria (o `/search` exige um termo), então o autocomplete continua
 * atendido pelas integrações seguintes da cadeia.
 */
export const integracaoMaisRetorno: IntegracaoCotacao = {
  id: MAIS_RETORNO_ID,
  nome: 'Mais Retorno',
  site: 'https://maisretorno.com/app/meu-perfil/api',
  exigeToken: true,
  comoObter:
    'gere a sua api-key (cada consulta de cotação consome 1 crédito do plano).',
  b3: {
    lerCache: lerCotacaoCache,
    atualizar: (tickers, { tokens, forceRefresh }) =>
      atualizarCotacoesMaisRetorno(tickers, { token: tokens[MAIS_RETORNO_ID], forceRefresh }),
  },
  tesouro: {
    lerCache: lerCotacoesTesouroCache,
    atualizar: (titulos, { tokens, forceRefresh }) =>
      atualizarCotacoesTesouroMaisRetorno(titulos, {
        token: tokens[MAIS_RETORNO_ID],
        forceRefresh,
      }),
  },
  setores: provedorSetoresMaisRetorno,
  limparCache() {
    clearMaisRetornoCache()
    clearMaisRetornoTesouroCache()
    clearMaisRetornoSetorCache()
  },
}
