import type { Configuracao } from '@/domain/entities'
import type { TokensProvedores } from '@/domain/provedoresCotacao'

/**
 * Configurações de integrações do usuário (aba `Configuracoes`, chave/valor).
 *
 * Persistir as credenciais/ajustes **na planilha** — em vez de variáveis de
 * ambiente `VITE_*` — permite que cada usuário configure as próprias
 * integrações (ex.: token de uma API de cotações) sem recompilar o app.
 *
 * Este módulo é puramente de domínio (sem rede, sem UI): só define as chaves
 * canônicas, o formato tipado e a conversão linha ↔ configuração. Os tokens
 * são genéricos por provedor (`<id>_token`, ex.: `brapi_token`).
 */

/** Sufixo das chaves de token (`<idDoProvedor>_token`). */
const SUFIXO_TOKEN = '_token'

/** Chave canônica do token de um provedor de cotações. */
export function chaveToken(idProvedor: string): string {
  return `${idProvedor}${SUFIXO_TOKEN}`
}

/** Configurações das integrações de cotação, já normalizadas. */
export interface IntegracoesConfig {
  /** Tokens por `id` do provedor (ausente/vazio = integração desligada). */
  tokens: TokensProvedores
}

/** Configuração vazia (nenhum parâmetro definido pelo usuário). */
export const INTEGRACOES_CONFIG_VAZIA: IntegracoesConfig = {
  tokens: {},
}

/** Converte as linhas da aba `Configuracoes` na configuração tipada. */
export function configDeRegistros(registros: readonly Configuracao[]): IntegracoesConfig {
  const tokens: Record<string, string> = {}
  for (const registro of registros) {
    const chave = registro.chave.trim()
    if (!chave.endsWith(SUFIXO_TOKEN) || chave.length === SUFIXO_TOKEN.length) continue
    tokens[chave.slice(0, -SUFIXO_TOKEN.length)] = registro.valor.trim()
  }
  return { tokens }
}

/** Converte a configuração tipada nas linhas a gravar na aba `Configuracoes`. */
export function registrosDeConfig(config: IntegracoesConfig): Configuracao[] {
  return Object.entries(config.tokens).map(([id, token]) => ({
    chave: chaveToken(id),
    valor: token.trim(),
  }))
}
