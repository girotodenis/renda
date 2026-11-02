import { isJsonBackend } from '@/infrastructure/googleConfig'

/**
 * Nomes do banco de dados na voz da interface.
 *
 * O backend do modo Google é escolhido em tempo de **build**
 * (`VITE_GOOGLE_BACKEND`): o padrão é um único arquivo cifrável no Drive
 * (`json`) e o alternativo é uma planilha do Sheets. Textos que dizem onde a
 * carteira mora passam por aqui para nenhum build prometer o formato do outro.
 */

/** Onde a carteira fica no modo Google (`em um arquivo...` / `em uma planilha...`). */
export function ondeFicaOCofreGoogle(): string {
  return isJsonBackend()
    ? 'em um arquivo no seu Google Drive'
    : 'em uma planilha do Google Sheets'
}

/** Frase sobre criptografia: só existe no cofre em arquivo. */
export function textoCriptografiaOpcional(): string {
  return isJsonBackend() ? ' O arquivo pode ser criptografado com uma senha só sua.' : ''
}

/** Resumo das permissões mínimas pedidas ao Google, na linguagem do backend ativo. */
export function textoPermissoesGoogle(): string {
  return isJsonBackend()
    ? 'acessar apenas os arquivos do banco de dados que o próprio app cria no seu Drive'
    : 'ler e editar a planilha que você escolher e acessar apenas os arquivos do Drive criados pelo app'
}
