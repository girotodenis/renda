import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { cellToNumber } from '@/infrastructure/sheets/sheetCells'
import { OdsFormatError, readZipEntries } from '@/infrastructure/ods/zipReader'

/**
 * Leitura de planilhas OpenDocument (`.ods`) — o caminho inverso da exportação.
 *
 * `content.xml` tem uma estrutura muito regular (gerada por programas), então em
 * vez de embarcar um parser XML usa-se um leitor dirigido ao subconjunto ODF:
 * `table:table` → `table:table-row` → `table:table-cell` + `text:p`.
 *
 * Três cuidados que evitam corromper dados na importação:
 * - **repetições** (`table:number-columns-repeated`/`rows-repeated`) são
 *   expandidas, com limites, pois escritores preenchem a largura da linha com
 *   células vazias repetidas;
 * - **anotações** (`office:annotation`) são ignoradas — senão o texto do
 *   comentário entraria no valor da célula;
 * - **datas** são devolvidas como ISO (quando o arquivo traz `office:date-value`)
 *   ou como serial, formatos que os codecs do app já entendem.
 */

/** Aba lida de um arquivo `.ods`. */
export interface AbaOdsLida {
  nome: string
  valores: CellValue[][]
}

/** Limites de segurança contra arquivos malformados/maliciosos. */
const MAX_ROWS_PER_SHEET = 20_000
const MAX_COLUMNS_PER_ROW = 256
const MAX_REPEAT = 1_000

const TAG_PATTERN = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"]*")*)\s*(\/?)>/y
const ATTR_PATTERN = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

interface CelulaAtual {
  valueType: string | null
  value: string | null
  booleanValue: string | null
  timeValue: string | null
  dateValue: string | null
  text: string
  repeats: number
}

interface TabelaAtual {
  nome: string
  linhas: CellValue[][]
}

/** Decodifica as entidades XML usadas em texto e atributos. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseAtributos(texto: string): Map<string, string> {
  const atributos = new Map<string, string>()
  ATTR_PATTERN.lastIndex = 0
  let match = ATTR_PATTERN.exec(texto)
  while (match) {
    atributos.set(match[1], decodeXmlEntities(match[2]))
    match = ATTR_PATTERN.exec(texto)
  }
  return atributos
}

function repeticao(atributos: Map<string, string> | null): number {
  const raw =
    atributos?.get('table:number-columns-repeated') ?? atributos?.get('table:number-rows-repeated')
  const valor = Number(raw)
  if (!Number.isFinite(valor) || valor < 1) return 1
  return Math.min(Math.floor(valor), MAX_REPEAT)
}

function criarCelula(atributos: Map<string, string> | null): CelulaAtual {
  return {
    valueType: atributos?.get('office:value-type') ?? null,
    value: atributos?.get('office:value') ?? null,
    booleanValue: atributos?.get('office:boolean-value') ?? null,
    timeValue: atributos?.get('office:time-value') ?? null,
    dateValue: atributos?.get('office:date-value') ?? null,
    text: '',
    repeats: repeticao(atributos),
  }
}

/** Converte a célula lida no valor tipado usado pela planilha do app. */
function valorDaCelula(celula: CelulaAtual): CellValue {
  // Célula sem tipo declarado: usa o texto exibido (importações manuais).
  if (celula.valueType === null) {
    const texto = celula.text.trim()
    return texto.length > 0 ? texto : null
  }

  switch (celula.valueType) {
    case 'float':
    case 'percentage':
    case 'currency': {
      const numero = Number(celula.value)
      if (Number.isFinite(numero)) return numero
      // `office:value` ausente: interpreta o texto exibido (aceita pt-BR).
      const doTexto = cellToNumber(celula.text, Number.NaN)
      if (Number.isFinite(doTexto)) return doTexto
      return celula.text.trim().length > 0 ? celula.text : null
    }
    case 'date': {
      // ISO já é aceito pelos codecs; serial (número) também.
      if (celula.dateValue !== null && ISO_DATE.test(celula.dateValue)) return celula.dateValue
      const serial = Number(celula.value)
      if (Number.isFinite(serial)) return serial
      return celula.text.trim().length > 0 ? celula.text : null
    }
    case 'time':
      return celula.timeValue ?? (celula.text.trim().length > 0 ? celula.text : null)
    case 'boolean':
      return celula.booleanValue === 'true'
    default:
      return celula.text.length > 0 ? celula.text : ''
  }
}

/**
 * Extrai as abas de um `content.xml`. Lê apenas o essencial (nome da aba, linhas
 * e valores tipados), ignorando estilos, colunas e anotações.
 */
export function parseContentXml(xml: string): AbaOdsLida[] {
  const abas: AbaOdsLida[] = []

  let tabela: TabelaAtual | null = null
  let linha: CellValue[] | null = null
  let linhaRepeats = 1
  let celula: CelulaAtual | null = null
  let emTexto = false
  let ignorandoProfundidade = 0

  function fecharCelula(): void {
    if (celula && linha) {
      const valor = valorDaCelula(celula)
      const espacoLivre = Math.max(0, MAX_COLUMNS_PER_ROW - linha.length)
      const vezes = Math.min(celula.repeats, espacoLivre)
      for (let index = 0; index < vezes; index += 1) linha.push(valor)
    }
    celula = null
    emTexto = false
  }

  function fecharLinha(): void {
    if (tabela && linha) {
      const espacoLivre = Math.max(0, MAX_ROWS_PER_SHEET - tabela.linhas.length)
      const vezes = Math.min(linhaRepeats, espacoLivre)
      for (let index = 0; index < vezes; index += 1) tabela.linhas.push(linha.slice())
    }
    linha = null
    linhaRepeats = 1
  }

  let index = 0
  while (index < xml.length) {
    const proximoTag = xml.indexOf('<', index)

    if (proximoTag < 0) {
      if (emTexto && celula && ignorandoProfundidade === 0) {
        celula.text += decodeXmlEntities(xml.slice(index))
      }
      break
    }

    if (proximoTag > index && emTexto && celula && ignorandoProfundidade === 0) {
      celula.text += decodeXmlEntities(xml.slice(index, proximoTag))
    }

    // Declaração XML, comentários e DOCTYPE não interessam.
    if (xml.startsWith('<?', proximoTag) || xml.startsWith('<!', proximoTag)) {
      const fim = xml.indexOf('>', proximoTag)
      index = fim < 0 ? xml.length : fim + 1
      continue
    }

    TAG_PATTERN.lastIndex = proximoTag
    const match = TAG_PATTERN.exec(xml)
    if (!match) {
      index = proximoTag + 1
      continue
    }
    index = TAG_PATTERN.lastIndex

    const [, fechamento, nome, textoAtributos, autoFechado] = match
    const atributos = textoAtributos ? parseAtributos(textoAtributos) : null
    const selfClosing = autoFechado === '/'

    if (nome === 'office:annotation') {
      if (fechamento) ignorandoProfundidade = Math.max(0, ignorandoProfundidade - 1)
      else if (!selfClosing) ignorandoProfundidade += 1
      continue
    }
    if (ignorandoProfundidade > 0) continue

    if (fechamento) {
      switch (nome) {
        case 'text:p':
          emTexto = false
          break
        case 'table:table-cell':
        case 'table:covered-table-cell':
          fecharCelula()
          break
        case 'table:table-row':
          fecharLinha()
          break
        case 'table:table':
          if (tabela) abas.push({ nome: tabela.nome, valores: tabela.linhas })
          tabela = null
          break
      }
      continue
    }

    switch (nome) {
      case 'table:table':
        tabela = { nome: atributos?.get('table:name') ?? '', linhas: [] }
        // Aba vazia é escrita como elemento auto-fechado: sem esta guarda, ela
        // desapareceria da importação (nada de `</table:table>` para fechar).
        if (selfClosing) {
          abas.push({ nome: tabela.nome, valores: tabela.linhas })
          tabela = null
        }
        break
      case 'table:table-row':
        linha = []
        linhaRepeats = repeticao(atributos)
        if (selfClosing) fecharLinha()
        break
      case 'table:table-cell':
      case 'table:covered-table-cell':
        celula = criarCelula(nome === 'table:covered-table-cell' ? null : atributos)
        if (selfClosing) fecharCelula()
        break
      case 'text:p':
        // Parágrafos adicionais do mesmo valor viram quebras de linha.
        if (celula && !selfClosing) {
          if (celula.text.length > 0) celula.text += '\n'
          emTexto = true
        }
        break
      case 'text:s':
        if (celula && emTexto) celula.text += ' '.repeat(repeticao(atributos))
        break
      case 'text:tab':
        if (celula && emTexto) celula.text += '\t'
        break
      case 'text:line-break':
        if (celula && emTexto) celula.text += '\n'
        break
    }
  }

  return abas
}

/**
 * Lê as abas de um arquivo `.ods` (descomprimindo o pacote quando necessário).
 * Lança `OdsFormatError` com mensagem amigável quando o arquivo não serve.
 */
export async function lerAbasOds(bytes: Uint8Array): Promise<AbaOdsLida[]> {
  const entries = await readZipEntries(bytes)
  const content = entries.find((entry) => entry.name === 'content.xml')

  if (!content) {
    if (entries.some((entry) => entry.name === '[Content_Types].xml')) {
      throw new OdsFormatError(
        'O arquivo parece ser uma planilha do Excel (.xlsx). Exporte/salve como .ods e tente novamente.',
      )
    }
    throw new OdsFormatError(
      'O arquivo .ods não contém content.xml — ele pode estar corrompido ou protegido por senha.',
    )
  }

  const abas = parseContentXml(new TextDecoder().decode(content.data))
  if (abas.length === 0) {
    throw new OdsFormatError('Nenhuma aba encontrada no arquivo .ods.')
  }
  return abas
}
