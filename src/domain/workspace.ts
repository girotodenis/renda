import type { SheetName } from '@/domain/sheetsSchema'

/** Mapa do `sheetId` (ID interno da aba no Google Sheets) por nome de aba. */
export type SheetIdMap = Record<SheetName, number>

/** Planilha selecionada ou criada pelo usuário (persistida no navegador). */
export interface SpreadsheetWorkspace {
  spreadsheetId: string
  title: string
  /** URL de edição da planilha, quando retornada pela API. */
  spreadsheetUrl: string | null
  sheetIds: SheetIdMap
  /** ISO 8601 do momento em que o workspace foi salvo/atualizado. */
  updatedAt: string
}

/** Referência leve a uma planilha no Drive (id + título). */
export interface PlanilhaExistente {
  spreadsheetId: string
  title: string
}

/**
 * Estado de autenticação da sessão.
 *
 * - `loading`: restaurando a sessão;
 * - `unauthenticated`: sem sessão e sem planilha configurada;
 * - `authenticated`: com token Google válido;
 * - `local`: planilha persistida mas sem token válido — o app abre direto com
 *   os dados do cache e o login só é solicitado quando uma operação precisar
 *   da rede (salvar, sincronizar, trocar de planilha).
 */
export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'local'
