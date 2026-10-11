import {
  configDeRegistros,
  INTEGRACOES_CONFIG_VAZIA,
  registrosDeConfig,
} from '@/domain/configuracoes'
import type { IntegracoesConfig } from '@/domain/configuracoes'
import { configuracoesRepo } from '@/services/repositories'
import type { RepositoryContext } from '@/services/repositories'
import { ensureRequiredSheets } from '@/services/sheets'

/**
 * Casos de uso das configurações de integrações (aba `Configuracoes`).
 *
 * A leitura é **cache-first** e tolerante: em planilhas antigas a aba pode
 * ainda não existir — nesse caso retornamos a configuração vazia, fazendo o app
 * usar os padrões. A escrita garante a aba (`ensureRequiredSheets`) e faz
 * upsert das chaves conhecidas, preservando eventuais chaves futuras.
 */

/** Lê as configurações das integrações (cache-first, tolerante a falhas). */
export async function carregarConfiguracoes(
  context: RepositoryContext,
  offline = false,
): Promise<IntegracoesConfig> {
  const doCache = (): IntegracoesConfig => {
    const cache = configuracoesRepo.readCache(context.spreadsheetId)
    return cache ? configDeRegistros(cache) : INTEGRACOES_CONFIG_VAZIA
  }

  if (offline) return doCache()
  try {
    return configDeRegistros(await configuracoesRepo.list(context))
  } catch {
    return doCache()
  }
}

/** Salva as configurações na aba, garantindo que ela exista (upsert por chave). */
export async function salvarConfiguracoes(
  context: RepositoryContext,
  config: IntegracoesConfig,
): Promise<void> {
  await ensureRequiredSheets(context.accessToken, context.spreadsheetId)

  const novasLinhas = registrosDeConfig(config)
  const chavesNovas = new Set(novasLinhas.map((linha) => linha.chave))

  let existentes: { chave: string; valor: string }[] = []
  try {
    existentes = await configuracoesRepo.refresh(context)
  } catch {
    existentes = configuracoesRepo.readCache(context.spreadsheetId) ?? []
  }

  // Preserva chaves desconhecidas (configurações de versões futuras).
  const preservadas = existentes.filter((linha) => !chavesNovas.has(linha.chave.trim()))

  await configuracoesRepo.replaceAll(context, [...preservadas, ...novasLinhas])
}
