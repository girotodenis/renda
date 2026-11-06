import type { ResultadoTesteIntegracao } from '@/domain/provedoresCotacao'
import {
  extrairCotacao,
  identificadorB3,
  urlCotacao,
} from '@/infrastructure/cotacoes/maisRetorno/cotacoesB3'
import { lerQuotaDosHeaders } from '@/infrastructure/cotacoes/quota'

/**
 * Teste de conexão da **Mais Retorno** usado pelo diagnóstico.
 *
 * Consulta `/quotes/petr4:b3` com a `X-Api-Key` do usuário — o mesmo endpoint
 * e o mesmo header do adaptador de cotações. Cada teste consome **1 crédito**
 * do plano, por isso é uma única chamada ao ticker de referência.
 */

/** Ticker usado no teste. */
export const MAIS_RETORNO_TICKER_TESTE = 'PETR4'

/** Tempo máximo de espera pelo teste (mesma política do adaptador). */
const REQUEST_TIMEOUT_MS = 10000

/** Mensagem para cada status HTTP relevante. */
function mensagemDoStatus(status: number): string {
  if (status === 401 || status === 403) {
    return `Chave recusada pela API (HTTP ${status}). Confira a api-key do plano.`
  }
  if (status === 429) return 'Créditos esgotados ou limite de requisições atingido (HTTP 429).'
  return `A API respondeu com erro HTTP ${status}.`
}

function semResposta(mensagem: string): ResultadoTesteIntegracao {
  return { ok: false, mensagem, quota: null, testadoEm: null }
}

/** Testa a conexão com a Mais Retorno. Nunca lança. */
export async function testarConexaoMaisRetorno(
  token: string | undefined,
  signal?: AbortSignal,
): Promise<ResultadoTesteIntegracao> {
  const chave = typeof token === 'string' ? token.trim() : ''
  if (chave.length === 0) {
    return semResposta('api-key não configurada — a integração fica desligada.')
  }
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    return semResposta('Este navegador não permite chamadas à API.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const cancelar = () => controller.abort()
  signal?.addEventListener('abort', cancelar, { once: true })

  try {
    const url = urlCotacao(identificadorB3(MAIS_RETORNO_TICKER_TESTE))
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Api-Key': chave },
    })
    const quota = lerQuotaDosHeaders(response.headers)
    const testadoEm = new Date().toISOString()

    if (!response.ok) {
      return { ok: false, mensagem: mensagemDoStatus(response.status), quota, testadoEm }
    }

    const cotacao = extrairCotacao(await response.json())
    if (!cotacao) {
      return {
        ok: false,
        mensagem: `A API respondeu, mas sem cotação de ${MAIS_RETORNO_TICKER_TESTE}.`,
        quota,
        testadoEm,
      }
    }

    return {
      ok: true,
      mensagem: `Conexão OK — cotação de ${MAIS_RETORNO_TICKER_TESTE} obtida.`,
      quota,
      testadoEm,
    }
  } catch {
    return semResposta('Não foi possível conectar (rede, CORS ou tempo esgotado).')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancelar)
  }
}
