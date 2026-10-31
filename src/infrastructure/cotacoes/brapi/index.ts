import type { IntegracaoCotacao } from '@/domain/provedoresCotacao'
import {
  atualizarCotacoesBrapi,
  clearBrapiCache,
  lerCotacaoCache,
} from '@/infrastructure/cotacoes/brapi/cotacoesB3'
import {
  atualizarCotacoesTesouroBrapi,
  clearBrapiTesouroCache,
  lerCotacoesTesouroCache,
} from '@/infrastructure/cotacoes/brapi/tesouro'
import { listarTickersBrapi } from '@/infrastructure/cotacoes/brapi/tickers'
import { clearBrapiSetorCache, provedorSetoresBrapi } from '@/infrastructure/cotacoes/brapi/perfil'

export const BRAPI_ID = 'brapi'

/** Adaptador da **Brapi.dev** para as portas de cotação do domínio. */
export const integracaoBrapi: IntegracaoCotacao = {
  id: BRAPI_ID,
  nome: 'Brapi',
  site: 'https://brapi.dev',
  exigeToken: true,
  dicaTesouroSemCotacao: 'Os preços do Tesouro Direto exigem o plano Pro da Brapi.',
  comoObter: 'copie o token no painel (conta gratuita).',
  b3: {
    lerCache: lerCotacaoCache,
    atualizar: (tickers, { tokens, forceRefresh, aoConsultar, signal }) =>
      atualizarCotacoesBrapi(tickers, {
        token: tokens[BRAPI_ID],
        forceRefresh,
        onTicker: (ticker) => aoConsultar?.(`ticker ${ticker}`),
        signal,
      }),
  },
  tesouro: {
    lerCache: lerCotacoesTesouroCache,
    atualizar: (titulos, { tokens, forceRefresh, aoConsultar, signal }) =>
      atualizarCotacoesTesouroBrapi(titulos, {
        token: tokens[BRAPI_ID],
        forceRefresh,
        onTicker: (ticker) => aoConsultar?.(`título ${ticker}`),
        signal,
      }),
  },
  tickers: { listar: listarTickersBrapi },
  setores: provedorSetoresBrapi,
  limparCache() {
    clearBrapiCache()
    clearBrapiTesouroCache()
    clearBrapiSetorCache()
  },
}
