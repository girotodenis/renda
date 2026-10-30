import {
  cadeiaCotacoesB3,
  cadeiaCotacoesTesouro,
  cadeiaListaTickers,
} from '@/domain/provedoresCotacao'
import type { IntegracaoCotacao } from '@/domain/provedoresCotacao'
import { integracaoBrapi } from '@/infrastructure/cotacoes/brapi'
import { integracaoMaisRetorno } from '@/infrastructure/cotacoes/maisRetorno'

/**
 * **Composição** das integrações de cotação.
 *
 * Para adicionar uma API: crie `infrastructure/cotacoes/<provedor>/index.ts`
 * exportando um `IntegracaoCotacao` e inclua-o nesta lista. A ordem define a
 * prioridade (fallback): cada integração só consulta o que as anteriores não
 * cotaram. O token aparece automaticamente em Configurações → Integrações.
 */
export const integracoesCotacao: readonly IntegracaoCotacao[] = [
  integracaoBrapi,
  integracaoMaisRetorno,
]

export const provedorCotacoesB3 = cadeiaCotacoesB3(integracoesCotacao)
export const provedorCotacoesTesouro = cadeiaCotacoesTesouro(integracoesCotacao)
export const provedorListaTickers = cadeiaListaTickers(integracoesCotacao)
