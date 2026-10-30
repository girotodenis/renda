/**
 * Tipos mínimos da File System Access API (`showSaveFilePicker`).
 *
 * A API existe nos navegadores Chromium mas ainda não faz parte do `lib.dom.d.ts`
 * do TypeScript. Declaramos apenas o necessário para "Salvar como" nativo, com
 * fallback para download quando a API não estiver disponível (Firefox/Safari/
 * mobile).
 */

interface ArquivoGravavelStream {
  write(data: BlobPart): Promise<void>
  close(): Promise<void>
}

interface ArquivoGravavelHandle {
  createWritable(): Promise<ArquivoGravavelStream>
}

interface OpcoesSalvarArquivo {
  suggestedName?: string
  types?: readonly {
    description?: string
    accept: Record<string, readonly string[]>
  }[]
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: OpcoesSalvarArquivo) => Promise<ArquivoGravavelHandle>
  }
}

export {}
