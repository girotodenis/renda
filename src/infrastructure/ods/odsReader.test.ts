import { describe, expect, it } from 'vitest'
import { buildOdsBytes } from '@/infrastructure/ods/odsWriter'
import { OdsFormatError } from '@/infrastructure/ods/zipReader'
import { lerAbasOds, parseContentXml } from '@/infrastructure/ods/odsReader'
import { createZip } from '@/infrastructure/ods/zip'

const encoder = new TextEncoder()

/** Amostra no formato que o LibreOffice gera (repetições, anotação, data). */
const CONTENT_LIBREOFFICE = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
  <office:body>
    <office:spreadsheet>
      <table:table table:name="Operacoes">
        <table:table-column table:number-columns-repeated="12"/>
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>ID</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>Data</text:p></table:table-cell>
          <table:table-cell table:number-columns-repeated="10"/>
        </table:table-row>
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>a1</text:p></table:table-cell>
          <table:table-cell office:value-type="date" office:date-value="2026-01-05T00:00:00" office:value="46027"><text:p>05/01/2026</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>Compra</text:p></table:table-cell>
          <table:table-cell office:value-type="float" office:value="100"><text:p>100</text:p></table:table-cell>
          <table:table-cell office:value-type="currency" office:currency="BRL" office:value="32.5"><text:p>R$ 32,50</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><office:annotation><text:p>nota interna</text:p></office:annotation><text:p>Tesouro</text:p></table:table-cell>
          <table:table-cell table:number-columns-repeated="2"/>
        </table:table-row>
        <table:table-row table:number-rows-repeated="2">
          <table:table-cell office:value-type="string"><text:p>a2</text:p></table:table-cell>
          <table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>VERDADEIRO</text:p></table:table-cell>
        </table:table-row>
      </table:table>
      <table:table table:name="Vazia"/>
    </office:spreadsheet>
  </office:body>
</office:document-content>`

describe('parseContentXml', () => {
  const abas = parseContentXml(CONTENT_LIBREOFFICE)
  const operacoes = abas[0]

  it('cria uma aba por table:table, preservando a ordem e a vazia', () => {
    expect(abas.map((aba) => aba.nome)).toEqual(['Operacoes', 'Vazia'])
    expect(abas[1].valores).toEqual([])
  })

  it('lê textos, números, datas e booleanos', () => {
    expect(operacoes.valores[0]?.slice(0, 2)).toEqual(['ID', 'Data'])
    expect(operacoes.valores[1]?.slice(0, 5)).toEqual([
      'a1',
      '2026-01-05T00:00:00',
      'Compra',
      100,
      32.5,
    ])
  })

  it('ignora o texto de anotações e mantém o valor da célula', () => {
    expect(operacoes.valores[1]?.[5]).toBe('Tesouro')
  })

  it('expande células repetidas como vazias', () => {
    expect(operacoes.valores[0]).toHaveLength(12)
    expect(operacoes.valores[0]?.slice(2)).toEqual(new Array(10).fill(null))
  })

  it('expande linhas repetidas', () => {
    const repetidas = operacoes.valores.slice(2)
    expect(repetidas).toHaveLength(2)
    expect(repetidas[0]).toEqual(['a2', true])
    expect(repetidas[1]).toEqual(['a2', true])
  })

  it('lê datas como serial quando o arquivo só traz office:value', () => {
    const [aba] = parseContentXml(
      '<table:table table:name="X"><table:table-row><table:table-cell office:value-type="date" office:value="46027"/></table:table-row></table:table>',
    )
    expect(aba.valores[0]).toEqual([46027])
  })

  it('devolve lista vazia para conteúdo sem tabelas', () => {
    expect(parseContentXml('<office:document-content/>')).toEqual([])
  })
})

describe('lerAbasOds — ida e volta com o próprio exportador', () => {
  it('relê exatamente o que o app exportou', async () => {
    const original = [
      {
        nome: 'Operacoes',
        valores: [
          ['ID', 'Ticker'],
          ['a1', 'PETR4'],
          [null, 10.5],
          [true, 'A & B <c>'],
        ],
      },
      { nome: 'Historico', valores: [] },
    ]

    const lidas = await lerAbasOds(buildOdsBytes(original))

    expect(lidas.map((aba) => aba.nome)).toEqual(['Operacoes', 'Historico'])
    expect(lidas[0].valores).toEqual(original[0].valores)
  })
})

describe('lerAbasOds — arquivos inválidos', () => {
  it('avisa quando o arquivo é .xlsx', async () => {
    const zip = createZip([
      { name: '[Content_Types].xml', data: encoder.encode('<Types/>') },
      { name: 'xl/workbook.xml', data: encoder.encode('<workbook/>') },
    ])

    await expect(lerAbasOds(zip)).rejects.toThrow(/xlsx/i)
  })

  it('avisa quando o .ods não tem content.xml', async () => {
    const zip = createZip([{ name: 'mimetype', data: encoder.encode('x') }])
    await expect(lerAbasOds(zip)).rejects.toBeInstanceOf(OdsFormatError)
  })

  it('avisa quando o content.xml não tem abas', async () => {
    const zip = createZip([{ name: 'content.xml', data: encoder.encode('<a/>') }])
    await expect(lerAbasOds(zip)).rejects.toThrow(/Nenhuma aba/)
  })

  it('rejeita arquivos que não são zip', async () => {
    await expect(lerAbasOds(encoder.encode('conteúdo qualquer'))).rejects.toBeInstanceOf(
      OdsFormatError,
    )
  })
})
