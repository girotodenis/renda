import { toArrayBuffer } from '@/infrastructure/ods/binary'

/**
 * Salvamento de arquivos gerados no cliente (exportação `.ods`).
 *
 * Estratégia em duas camadas:
 *
 * 1. **File System Access API** (`showSaveFilePicker`) quando disponível
 *    (Chromium desktop): abre o diálogo nativo "Salvar como" e escreve direto
 *    no arquivo escolhido — o usuário decide pasta e nome.
 * 2. **Download** (`<a download>` + `Blob`), fallback universal (Firefox,
 *    Safari, mobile): o arquivo vai para a pasta de downloads do navegador.
 *
 * O cancelamento do diálogo (`AbortError`) é tratado como resultado normal
 * (não é erro): o usuário simplesmente desistiu.
 */

/** Resultado de uma tentativa de salvar/baixar o arquivo. */
export type ResultadoSalvamento = 'salvo' | 'baixado' | 'cancelado'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Dispara o download do blob (fallback sem a File System Access API). */
function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nomeArquivo
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Libera a URL depois que o navegador iniciou o download.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** `true` quando o navegador suporta o diálogo nativo "Salvar como". */
export function podeSalvarComDialogo(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/**
 * Salva o arquivo pelo diálogo nativo quando possível; caso contrário, baixa.
 *
 * @param extensao Extensão sugerida no filtro do diálogo (ex.: `.ods`).
 */
export async function salvarOuBaixarArquivo(
  bytes: Uint8Array,
  nomeArquivo: string,
  mimeType: string,
  extensao: string,
  descricao = 'Arquivo',
): Promise<ResultadoSalvamento> {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new Error('Este ambiente não permite salvar arquivos.')
  }

  // `BlobPart` exige um `ArrayBuffer` próprio (não `SharedArrayBuffer`).
  const blob = new Blob([toArrayBuffer(bytes)], { type: mimeType })

  if (podeSalvarComDialogo()) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: nomeArquivo,
        types: [{ description: descricao, accept: { [mimeType]: [extensao] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'salvo'
    } catch (error) {
      if (isAbortError(error)) return 'cancelado'
      // Outras falhas (permissão, escrita): cai no download universal.
    }
  }

  baixarBlob(blob, nomeArquivo)
  return 'baixado'
}
