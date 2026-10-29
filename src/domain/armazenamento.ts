import { SHEET_NAMES } from '@/domain/sheetsSchema'
import type { SheetName } from '@/domain/sheetsSchema'
import type { SpreadsheetWorkspace } from '@/domain/workspace'

/**
 * Modo de armazenamento da carteira (RF01/RF02).
 *
 * O app aceita **duas origens de dados** com o mesmo modelo de domínio:
 *
 * - `google`: banco na nuvem (exige login OAuth) — planilha do Google Sheets ou
 *   um arquivo JSON compactado no Google Drive, conforme o backend de build
 *   `VITE_GOOGLE_BACKEND`;
 * - `local`: banco de dados local do navegador (IndexedDB), **sem login** —
 *   a carteira vive só no dispositivo e pode ser exportada para `.ods`.
 *
 * O modo é uma escolha explícita do usuário e fica persistida no navegador
 * (`infrastructure/modoArmazenamento.ts`). Nenhuma regra de negócio depende
 * dele: os casos de uso continuam falando apenas com os *ports* de repositório.
 */

/** Origens de dados suportadas. */
export type ModoArmazenamento = 'google' | 'local'

/** Valores literais do modo (evita strings soltas pelo código). */
export const MODO_GOOGLE: ModoArmazenamento = 'google'
export const MODO_LOCAL: ModoArmazenamento = 'local'

/** Modo padrão (compatível com o comportamento anterior ao modo local). */
export const MODO_ARMAZENAMENTO_PADRAO: ModoArmazenamento = MODO_GOOGLE

/**
 * Identificador sintético do "workspace" local.
 *
 * O modo local não tem banco remoto, mas reutiliza `SpreadsheetWorkspace`
 * para que o cache de abas (chaveado por `spreadsheetId`) e todos os casos de
 * uso existentes funcionem sem alteração.
 */
export const WORKSPACE_LOCAL_ID = 'local'

/** Título exibido como "planilha ativa" no modo local. */
export const TITULO_WORKSPACE_LOCAL = 'Minhas Ações — neste navegador'

/**
 * Token sentinela usado no modo local.
 *
 * Os casos de uso exigem um `accessToken` não vazio no `RepositoryContext`
 * (porta de repositório). No modo local ele **nunca** vai para a rede: os
 * adaptadores apenas o ignoram. Usar um valor sentinela evita espalhar
 * condicionais de modo por toda a camada de apresentação.
 */
export const TOKEN_MODO_LOCAL = 'local'

/** Normaliza um valor lido do armazenamento para um modo válido. */
export function parseModoArmazenamento(value: unknown): ModoArmazenamento {
  return value === 'local' ? 'local' : MODO_ARMAZENAMENTO_PADRAO
}

/** `true` quando o `spreadsheetId` pertence ao workspace local. */
export function isWorkspaceLocal(spreadsheetId: string): boolean {
  return spreadsheetId === WORKSPACE_LOCAL_ID
}

/**
 * Cria o workspace sintético do modo local.
 *
 * `updatedAt` é injetado (não lido de `Date`) para manter o domínio
 * determinístico e testável.
 */
export function criarWorkspaceLocal(updatedAt: string): SpreadsheetWorkspace {
  const sheetIds = {} as Record<SheetName, number>
  SHEET_NAMES.forEach((name, index) => {
    sheetIds[name] = index
  })

  return {
    spreadsheetId: WORKSPACE_LOCAL_ID,
    title: TITULO_WORKSPACE_LOCAL,
    spreadsheetUrl: null,
    sheetIds,
    updatedAt,
  }
}
