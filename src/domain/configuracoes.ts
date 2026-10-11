import type { Configuracao } from '@/domain/entities'

/**
 * Configurações de integrações do usuário (aba `Configuracoes`, chave/valor).
 *
 * Persistir as credenciais/ajustes **na planilha** — em vez de variáveis de
 * ambiente `VITE_*` — permite que cada usuário configure as próprias
 * integrações (ex.: token da Brapi) sem recompilar o app.
 *
 * Este módulo é puramente de domínio (sem rede, sem UI): só define as chaves
 * canônicas, o formato tipado e a conversão linha ↔ configuração.
 */

/** Chaves canônicas dos parâmetros persistidos na aba `Configuracoes`. */
export const CONFIG_CHAVES = {
  /** Token da Brapi.dev (`''` = fallback de cotação B3 desligado). */
  brapiToken: 'brapi_token',
} as const

export type ConfigChave = (typeof CONFIG_CHAVES)[keyof typeof CONFIG_CHAVES]

/** Configurações das integrações de cotação, já normalizadas. */
export interface IntegracoesConfig {
  /** Token da Brapi.dev (vazio = fallback desligado). */
  brapiToken: string
}

/** Configuração vazia (nenhum parâmetro definido pelo usuário). */
export const INTEGRACOES_CONFIG_VAZIA: IntegracoesConfig = {
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
    brapiToken: mapa.get(CONFIG_CHAVES.brapiToken) ?? '',
  }
}

/** Converte a configuração tipada nas linhas a gravar na aba `Configuracoes`. */
export function registrosDeConfig(config: IntegracoesConfig): Configuracao[] {
  return [{ chave: CONFIG_CHAVES.brapiToken, valor: config.brapiToken.trim() }]
}
