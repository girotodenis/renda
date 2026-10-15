import { describe, expect, it } from 'vitest'
import {
  ODS_MIMETYPE,
  buildContentXml,
  buildManifestXml,
  buildOdsBytes,
  escapeXml,
} from '@/infrastructure/ods/odsWriter'
import type { AbaOds } from '@/infrastructure/ods/odsWriter'

const ABAS: AbaOds[] = [
  {
    nome: 'Operacoes',
    valores: [
      ['ID', 'Ticker'],
      ['a1', 'PETR4'],
      [null, 10.5],
    ],
  },
  { nome: 'Historico', valores: [] },
]

describe('escapeXml', () => {
  it('escapa os caracteres reservados do XML', () => {
    expect(escapeXml('A & B <tag> "aspas" \'simples\'')).toBe(
      'A &amp; B &lt;tag&gt; &quot;aspas&quot; &apos;simples&apos;',
    )
  })

  it('descarta caracteres de controle inválidos', () => {
    expect(escapeXml('a\u0000b\u001fc')).toBe('abc')
  })
})

describe('buildContentXml', () => {
  const xml = buildContentXml(ABAS)

  it('cria uma tabela por aba', () => {
    expect(xml).toContain('<table:table table:name="Operacoes">')
    expect(xml).toContain('<table:table table:name="Historico"/>')
  })

  it('grava números como float e textos como string', () => {
    expect(xml).toContain('office:value-type="float" office:value="10.5"')
    expect(xml).toContain('<text:p>PETR4</text:p>')
    expect(xml).toContain('office:value-type="string"')
  })

  it('representa células vazias sem valor', () => {
    expect(xml).toContain('<table:table-cell/>')
  })
})

describe('buildManifestXml', () => {
  it('declara o pacote como planilha OpenDocument', () => {
    const xml = buildManifestXml()
    expect(xml).toContain('manifest:full-path="/"')
    expect(xml).toContain(ODS_MIMETYPE)
    expect(xml).toContain('manifest:full-path="content.xml"')
  })
})

describe('buildOdsBytes', () => {
  it('usa o mimetype como primeira entrada, sem compressão', () => {
    const bytes = buildOdsBytes(ABAS)
    const view = new DataView(bytes.buffer)

    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('PK\u0003\u0004')
    expect(view.getUint16(8, true)).toBe(0)

    const nameLength = view.getUint16(26, true)
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength))
    expect(name).toBe('mimetype')

    const dataLength = view.getUint32(18, true)
    const mimetype = new TextDecoder().decode(bytes.slice(30 + nameLength, 30 + nameLength + dataLength))
    expect(mimetype).toBe(ODS_MIMETYPE)
  })

  it('inclui as cinco entradas do pacote ODF', () => {
    const bytes = buildOdsBytes(ABAS)
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(5)
  })

  it('gera saída determinística quando não há data', () => {
    expect(Array.from(buildOdsBytes(ABAS))).toEqual(Array.from(buildOdsBytes(ABAS)))
  })
})
