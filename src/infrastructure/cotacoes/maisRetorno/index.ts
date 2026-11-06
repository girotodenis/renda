import type { IntegracaoCotacao } from '@/domain/provedoresCotacao'
import {
  atualizarCotacoesCriptoMaisRetorno,
  atualizarCotacoesMaisRetorno,
  clearMaisRetornoCache,
  lerCotacaoCache,
  lerCotacaoCriptoCache,
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
import { testarConexaoMaisRetorno } from '@/infrastructure/cotacoes/maisRetorno/teste'

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
    atualizar: (tickers, { tokens, forceRefresh, aoConsultar, signal }) =>
      atualizarCotacoesMaisRetorno(tickers, {
        token: tokens[MAIS_RETORNO_ID],
        forceRefresh,
        onTicker: (ticker) => aoConsultar?.(`ticker ${ticker}`),
        signal,
      }),
  },
  cripto: {
    lerCache: lerCotacaoCriptoCache,
    atualizar: (tickers, { tokens, forceRefresh, aoConsultar, signal }) =>
      atualizarCotacoesCriptoMaisRetorno(tickers, {
        token: tokens[MAIS_RETORNO_ID],
        forceRefresh,
        onTicker: (ticker) => aoConsultar?.(`cripto ${ticker}`),
        signal,
      }),
  },
  tesouro: {
    lerCache: lerCotacoesTesouroCache,
    atualizar: (titulos, { tokens, forceRefresh, aoConsultar, signal }) =>
      atualizarCotacoesTesouroMaisRetorno(titulos, {
        token: tokens[MAIS_RETORNO_ID],
        forceRefresh,
        onTicker: (titulo) => aoConsultar?.(`título ${titulo}`),
        signal,
      }),
  },
  setores: provedorSetoresMaisRetorno,
  teste: {
    testar: ({ tokens, signal }) => testarConexaoMaisRetorno(tokens[MAIS_RETORNO_ID], signal),
  },
  limparCache() {
    clearMaisRetornoCache()
    clearMaisRetornoTesouroCache()
    clearMaisRetornoSetorCache()
  },
}
