import type { RepositoryContext } from '@/domain/repositories/ports'
import { ODS_MIMETYPE, buildOdsBytes } from '@/infrastructure/ods/odsWriter'
import type { AbaOds } from '@/infrastructure/ods/odsWriter'
import { salvarOuBaixarArquivo } from '@/infrastructure/ods/download'
import type { ResultadoSalvamento } from '@/infrastructure/ods/download'
import { lerAbasParaExportacao } from '@/infrastructure/sheets/gatewayRouter'

/**
 * Exportação da carteira para `.ods` (RF02 — interoperabilidade).
 *
 * Funciona nas duas origens de dados: no modo local lê o IndexedDB; no modo
 * Google lê a planilha ativa. O arquivo é um `.ods` "de valores" — sem
 * fórmulas, para abrir igual em LibreOffice, Excel ou Google Planilhas.
 */

/** Arquivo `.ods` gerado em memória. */
export interface ArquivoOds {
  nome: string
  bytes: Uint8Array
}

/** Resultado da exportação para a UI. */
export interface ResultadoExportacao {
  status: ResultadoSalvamento
  nome: string
}

/** Converte um título livre em um nome de arquivo seguro (slug ASCII). */
export function nomeArquivoOds(titulo: string, dataIso: string): string {
  const slug = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  const data = dataIso.slice(0, 10)
  return `${slug.length > 0 ? slug : 'minhas-acoes'}-${data}.ods`
}

/** Lê todas as abas da origem ativa (cabeçalho + dados) para exportação. */
export async function gerarPlanilhaOds(context: RepositoryContext): Promise<AbaOds[]> {
  return lerAbasParaExportacao(context)
}

/**
 * Exporta a carteira para `.ods` (diálogo nativo quando disponível, senão
 * download). Devolve o status e o nome sugerido do arquivo.
 */
export async function exportarPlanilhaOds(
  context: RepositoryContext,
  titulo: string,
  hojeIso: string,
): Promise<ResultadoExportacao> {
  const abas = await gerarPlanilhaOds(context)
  const nome = nomeArquivoOds(titulo, hojeIso)
  const bytes = buildOdsBytes(abas, { geradoEm: hojeIso })
  const status = await salvarOuBaixarArquivo(bytes, nome, ODS_MIMETYPE, '.ods', 'Planilha OpenDocument')

  return { status, nome }
}
