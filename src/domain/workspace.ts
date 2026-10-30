import type { SheetName } from '@/domain/sheetsSchema'

/** Mapa do `sheetId` (ID interno da aba no Google Sheets) por nome de aba. */
export type SheetIdMap = Record<SheetName, number>

/**
 * Banco de dados selecionado ou criado pelo usuário (persistido no navegador).
 *
 * `spreadsheetId` é o identificador da origem ativa: no backend `sheets` é o id
 * da planilha no Google Sheets; no backend `json` é o **id do arquivo JSON no
 * Google Drive**. O contrato é o mesmo para os dois casos (o cache de abas é
 * chaveado por ele).
 */
export interface SpreadsheetWorkspace {
  spreadsheetId: string
  title: string
  /** URL de edição do banco (Sheets ou Drive), quando conhecida. */
  spreadsheetUrl: string | null
  sheetIds: SheetIdMap
  /** ISO 8601 do momento em que o workspace foi salvo/atualizado. */
  updatedAt: string
}

/** Referência leve a um banco no Drive (id + título). */
export interface PlanilhaExistente {
  spreadsheetId: string
  title: string
  /** ISO do último modificado, quando a listagem informa (usado na lista de bancos). */
  modificadaEm?: string | null
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
