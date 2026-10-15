import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { createZip } from '@/infrastructure/ods/zip'
import type { ZipEntry } from '@/infrastructure/ods/zip'

/**
 * Geração de planilha OpenDocument (`.ods`).
 *
 * O `.ods` é montado com o mínimo exigido pelo padrão ODF 1.3 — sem estilos
 * avançados, gráficos ou fórmulas. Os valores são gravados como **valores**
 * (números como `float`, textos como `string`), e não como fórmulas: o modo
 * local não tem superfície de cálculo (não existe `GOOGLEFINANCE` no Calc),
 * então o que o app calcula é o que fica no arquivo.
 */

export const ODS_MIMETYPE = 'application/vnd.oasis.opendocument.spreadsheet'
export const ODS_VERSION = '1.3'
export const ODS_GENERATOR = 'Minhas Ações'

const NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const NS_STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const NS_FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'
const NS_META = 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0'
const NS_DC = 'http://purl.org/dc/elements/1.1/'
const NS_MANIFEST = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0'

/** Uma aba do arquivo `.ods` (linha 1 = cabeçalho). */
export interface AbaOds {
  nome: string
  valores: readonly (readonly CellValue[])[]
}

/** Opções de geração do arquivo. */
export interface OdsOptions {
  /** Data ISO de geração (metadado `dc:date`); `null` omite o metadado. */
  geradoEm?: string | null
  /** Data/hora dos cabeçalhos do ZIP (`null` = determinística). */
  modifiedAt?: Date | null
}

/** Escapa texto/atributo para XML, descartando caracteres de controle inválidos. */
export function escapeXml(value: string): string {
  return value
    // O XML 1.0 não admite caracteres de controle (exceto TAB/LF/CR): removê-los
    // evita gerar um `content.xml` inválido a partir de células coladas.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Serializa um número sem notação de locale (ODF exige ponto decimal). */
function formatNumber(value: number): string {
  return String(value)
}

/** Converte uma célula da planilha em `<table:table-cell>` do ODF. */
export function celulaOds(cell: CellValue): string {
  if (cell === null || cell === undefined) return '<table:table-cell/>'

  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return '<table:table-cell/>'
    const value = formatNumber(cell)
    return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`
  }

  if (typeof cell === 'boolean') {
    return `<table:table-cell office:value-type="boolean" office:boolean-value="${cell}"><text:p>${
      cell ? 'VERDADEIRO' : 'FALSO'
    }</text:p></table:table-cell>`
  }

  const text = String(cell)
  if (text.trim().length === 0) return '<table:table-cell/>'
  return `<table:table-cell office:value-type="string"><text:p>${escapeXml(text)}</text:p></table:table-cell>`
}

/** Gera o `content.xml` com todas as abas (uma `<table:table>` por aba). */
export function buildContentXml(abas: readonly AbaOds[]): string {
  const tables = abas.map((aba) => {
    const name = escapeXml(aba.nome)
    if (aba.valores.length === 0) return `    <table:table table:name="${name}"/>`

    const rows = aba.valores
      .map(
        (row) =>
          `      <table:table-row>${row
            .map((cell) => celulaOds(cell))
            .join('')}</table:table-row>`,
      )
      .join('\n')

    return `    <table:table table:name="${name}">\n${rows}\n    </table:table>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="${NS_OFFICE}" xmlns:table="${NS_TABLE}" xmlns:text="${NS_TEXT}" xmlns:style="${NS_STYLE}" xmlns:fo="${NS_FO}" office:version="${ODS_VERSION}">
  <office:body>
    <office:spreadsheet>
${tables.join('\n')}
    </office:spreadsheet>
  </office:body>
</office:document-content>
`
}

/** Gera o `META-INF/manifest.xml` (obrigatório no pacote ODF). */
export function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="${NS_MANIFEST}" manifest:version="${ODS_VERSION}">
  <manifest:file-entry manifest:full-path="/" manifest:version="${ODS_VERSION}" manifest:media-type="${ODS_MIMETYPE}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
`
}

/** Gera o `styles.xml` mínimo aceito pelo LibreOffice. */
export function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="${NS_OFFICE}" xmlns:style="${NS_STYLE}" xmlns:fo="${NS_FO}" office:version="${ODS_VERSION}">
  <office:styles/>
  <office:automatic-styles/>
  <office:master-styles/>
</office:document-styles>
`
}

/** Gera o `meta.xml` (metadados do documento). */
export function buildMetaXml(geradoEm: string | null): string {
  const date = geradoEm ? `\n    <dc:date>${escapeXml(geradoEm)}</dc:date>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="${NS_OFFICE}" xmlns:meta="${NS_META}" xmlns:dc="${NS_DC}" office:version="${ODS_VERSION}">
  <office:meta>
    <meta:generator>${escapeXml(ODS_GENERATOR)}</meta:generator>${date}
  </office:meta>
</office:document-meta>
`
}

/** Monta os bytes do arquivo `.ods` (ZIP com `mimetype` como 1ª entrada). */
export function buildOdsBytes(abas: readonly AbaOds[], options: OdsOptions = {}): Uint8Array {
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: encoder.encode(ODS_MIMETYPE) },
    { name: 'META-INF/manifest.xml', data: encoder.encode(buildManifestXml()) },
    { name: 'content.xml', data: encoder.encode(buildContentXml(abas)) },
    { name: 'styles.xml', data: encoder.encode(buildStylesXml()) },
    { name: 'meta.xml', data: encoder.encode(buildMetaXml(options.geradoEm ?? null)) },
  ]

  return createZip(entries, { modifiedAt: options.modifiedAt ?? null })
}
