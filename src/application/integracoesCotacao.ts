import type { CategoriaAtivo } from '@/domain/entities'
import type { IntegracaoCotacao, OpcoesConsultaCotacoes, ResultadoTesteIntegracao } from '@/domain/provedoresCotacao'
import type { RepositoryContext } from '@/domain/repositories/ports'
import { integracoesCotacao, provedorListaTickers } from '@/infrastructure/cotacoes/registro'
import { carregarConfiguracoes } from '@/application/configuracoes'

/**
 * Casos de uso das integrações de cotação expostos à UI, que assim não
 * depende de nenhuma API concreta (os adaptadores vivem na infraestrutura).
 */

/** Dados de uma integração exibidos em Configurações → Integrações. */
export type IntegracaoCotacaoInfo = Pick<
  IntegracaoCotacao,
  'id' | 'nome' | 'site' | 'exigeToken' | 'comoObter'
>

/** Integrações de cotação registradas, em ordem de prioridade. */
export function listarIntegracoesCotacao(): IntegracaoCotacaoInfo[] {
  return integracoesCotacao.map(({ id, nome, site, exigeToken, comoObter }) => ({
    id,
    nome,
    site,
    exigeToken,
    comoObter,
  }))
}

/** Limpa o cache local de todas as integrações (ex.: após trocar tokens). */
export function limparCachesCotacao(): void {
  for (const integracao of integracoesCotacao) integracao.limparCache()
}

/** Tickers negociados da categoria (autocomplete); `[]` quando indisponível. */
export function listarTickersMercado(categoria: CategoriaAtivo): Promise<string[]> {
  return provedorListaTickers.listar(categoria)
}

/** Teste de uma integração + o contexto do token no ambiente. */
export interface TesteIntegracaoInfo {
  id: string
  nome: string
  exigeToken: boolean
  /** `true` quando não exige token ou o token está preenchido. */
  tokenConfigurado: boolean
  resultado: ResultadoTesteIntegracao
}

/** Relatório do teste de todas as integrações (diagnóstico). */
export interface DiagnosticoIntegracoes {
  startedAt: string
  finishedAt: string
  testes: TesteIntegracaoInfo[]
  /**
   * `true` quando todas as integrações que **exigem token** estão configuradas
   * e responderam. Fontes opcionais (planilha de cotações) não invalidam o
   * resultado — o estado delas aparece no card do ambiente.
   */
  todasOk: boolean
}

const SEM_TESTE: ResultadoTesteIntegracao = {
  ok: false,
  mensagem: 'Esta integração não oferece teste de conexão.',
  quota: null,
  testadoEm: null,
}

/**
 * Testa a conexão de todas as integrações de cotação registradas.
 *
 * Usa os mesmos tokens da aba `Configuracoes` e a cadeia de adaptadores que o
 * app usa de verdade — um teste verde significa que a cotação funciona, não
 * apenas que a API está no ar. Cada integração faz **uma** requisição ao ticker
 * de referência (consome 1 crédito/requisição da cota) e informa a cota
 * restante quando a API devolve os headers `RateLimit-*`.
 *
 * Nunca lança: falhas individuais viram `ok: false` com mensagem.
 */
export async function testarIntegracoesCotacao(
  context: RepositoryContext | null,
): Promise<DiagnosticoIntegracoes> {
  const startedAt = new Date().toISOString()

  const config = context
    ? await carregarConfiguracoes(context).catch(() => null)
    : null
  const opcoes: OpcoesConsultaCotacoes = {
    tokens: config?.tokens ?? {},
    accessToken: context?.accessToken,
    forceRefresh: true,
  }

  const testes = await Promise.all(
    integracoesCotacao.map(async (integracao): Promise<TesteIntegracaoInfo> => {
      const token = (opcoes.tokens[integracao.id] ?? '').trim()
      const tokenConfigurado = !integracao.exigeToken || token.length > 0
      const base = {
        id: integracao.id,
        nome: integracao.nome,
        exigeToken: integracao.exigeToken,
        tokenConfigurado,
      }

      if (!integracao.teste) return { ...base, resultado: SEM_TESTE }

      try {
        const resultado = await integracao.teste.testar(opcoes)
        return { ...base, resultado }
      } catch {
        return {
          ...base,
          resultado: {
            ok: false,
            mensagem: 'Falha inesperada ao testar a integração.',
            quota: null,
            testadoEm: null,
          },
        }
      }
    }),
  )

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    testes,
    todasOk: testes.every(
      (teste) => !teste.exigeToken || (teste.tokenConfigurado && teste.resultado.ok),
    ),
  }
}
