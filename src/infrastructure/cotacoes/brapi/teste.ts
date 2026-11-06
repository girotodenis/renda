import type { ResultadoTesteIntegracao } from '@/domain/provedoresCotacao'
import { BRAPI_QUOTE_URL, extrairCotacoes } from '@/infrastructure/cotacoes/brapi/cotacoesB3'
import { lerQuotaDosHeaders } from '@/infrastructure/cotacoes/quota'

/**
 * Teste de conexão da **Brapi** usado pelo diagnóstico.
 *
 * Faz **uma** requisição ao endpoint de cotação (o mesmo do app) para o ticker
 * de teste `PETR4` e transforma a resposta em um resultado pronto para a tela:
 * sucesso, token ausente, 401/403/429 ou falha de rede. A cota do plano
 * (`RateLimit-*`) vem dos headers da própria resposta.
 */

/** Ticker usado no teste — responde até sem token na Brapi. */
export const BRAPI_TICKER_TESTE = 'PETR4'

/** Tempo máximo de espera pelo teste (mesma política do adaptador). */
const REQUEST_TIMEOUT_MS = 8000

/** Mensagem para cada status HTTP relevante. */
function mensagemDoStatus(status: number): string {
  if (status === 401) return 'Token inválido ou ausente (HTTP 401). Copie a chave no painel da Brapi.'
  if (status === 403) return 'O plano não inclui a cotação de teste (HTTP 403).'
  if (status === 429) return 'Cota esgotada ou limite de requisições simultâneas (HTTP 429).'
  return `A API respondeu com erro HTTP ${status}.`
}

function semResposta(mensagem: string): ResultadoTesteIntegracao {
  return { ok: false, mensagem, quota: null, testadoEm: null }
}

/** Testa a conexão com a Brapi. Nunca lança. */
export async function testarConexaoBrapi(
  token: string | undefined,
  signal?: AbortSignal,
): Promise<ResultadoTesteIntegracao> {
  const chave = typeof token === 'string' ? token.trim() : ''
  if (chave.length === 0) {
    return semResposta('Token não configurado — a integração fica desligada.')
  }
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    return semResposta('Este navegador não permite chamadas à API.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const cancelar = () => controller.abort()
  signal?.addEventListener('abort', cancelar, { once: true })

  try {
    const url = `${BRAPI_QUOTE_URL}/${BRAPI_TICKER_TESTE}?token=${encodeURIComponent(chave)}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    const quota = lerQuotaDosHeaders(response.headers)
    const testadoEm = new Date().toISOString()

    if (!response.ok) {
      return { ok: false, mensagem: mensagemDoStatus(response.status), quota, testadoEm }
    }

    const payload: unknown = await response.json()
    const cotacao = extrairCotacoes(payload).get(BRAPI_TICKER_TESTE)
    if (!cotacao) {
      return {
        ok: false,
        mensagem: `A API respondeu, mas sem cotação de ${BRAPI_TICKER_TESTE}.`,
        quota,
        testadoEm,
      }
    }

    return {
      ok: true,
      mensagem: `Conexão OK — cotação de ${BRAPI_TICKER_TESTE} obtida.`,
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
