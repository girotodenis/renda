import type { Configuracao } from '@/domain/entities'

/**
 * Configurações de integrações do usuário (aba `Configuracoes`, chave/valor).
 *
 * Persistir as credenciais/ajustes **na planilha** — em vez de variáveis de
 * ambiente `VITE_*` — permite que cada usuário configure as próprias
 * integrações (ex.: token da Brapi, endpoint do Tesouro) sem recompilar o app.
 *
 * Este módulo é puramente de domínio (sem rede, sem UI): só define as chaves
 * canônicas, o formato tipado e a conversão linha ↔ configuração.
 */

/**
 * Endpoint padrão de dados abertos do Tesouro Transparente (CKAN).
 *
 * Usado quando o usuário deixa o campo **Tesouro API URL** em branco — a
 * integração continua funcionando sem nenhuma configuração.
 */
export const DEFAULT_TESOURO_API_URL =
  'https://www.tesourotransparente.gov.br/ckan/api/3/action/datastore_search?resource_id=df56aa42-484a-4a59-8184-7676580c81e3&limit=2000'

/** Chaves canônicas dos parâmetros persistidos na aba `Configuracoes`. */
export const CONFIG_CHAVES = {
  /** Endpoint de cotações do Tesouro Direto (`''` = usar o padrão). */
  tesouroApiUrl: 'tesouro_api_url',
  /** Token da Brapi.dev (`''` = fallback de cotação B3 desligado). */
  brapiToken: 'brapi_token',
} as const

export type ConfigChave = (typeof CONFIG_CHAVES)[keyof typeof CONFIG_CHAVES]

/** Configurações das integrações de cotação, já normalizadas. */
export interface IntegracoesConfig {
  /** Endpoint do Tesouro Direto (vazio = `DEFAULT_TESOURO_API_URL`). */
  tesouroApiUrl: string
  /** Token da Brapi.dev (vazio = fallback desligado). */
  brapiToken: string
}

/** Configuração vazia (nenhum parâmetro definido pelo usuário). */
export const INTEGRACOES_CONFIG_VAZIA: IntegracoesConfig = {
  tesouroApiUrl: '',
  brapiToken: '',
}

/** Converte as linhas da aba `Configuracoes` na configuração tipada. */
export function configDeRegistros(registros: readonly Configuracao[]): IntegracoesConfig {
  const mapa = new Map<string, string>()
  for (const registro of registros) {
    const chave = registro.chave.trim()
    if (chave.length === 0) continue
    mapa.set(chave, registro.valor.trim())
  }
  return {
    tesouroApiUrl: mapa.get(CONFIG_CHAVES.tesouroApiUrl) ?? '',
    brapiToken: mapa.get(CONFIG_CHAVES.brapiToken) ?? '',
  }
}

/** Converte a configuração tipada nas linhas a gravar na aba `Configuracoes`. */
export function registrosDeConfig(config: IntegracoesConfig): Configuracao[] {
  return [
    { chave: CONFIG_CHAVES.tesouroApiUrl, valor: config.tesouroApiUrl.trim() },
    { chave: CONFIG_CHAVES.brapiToken, valor: config.brapiToken.trim() },
  ]
}

/** Endpoint efetivo do Tesouro (config do usuário ou o padrão). */
export function resolverTesouroApiUrl(config: IntegracoesConfig): string {
  return config.tesouroApiUrl.trim().length > 0 ? config.tesouroApiUrl.trim() : DEFAULT_TESOURO_API_URL
}
