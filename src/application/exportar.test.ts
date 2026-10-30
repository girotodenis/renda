import { afterEach, describe, expect, it } from 'vitest'
import { MODO_GOOGLE, MODO_LOCAL, WORKSPACE_LOCAL_ID } from '@/domain/armazenamento'
import { setModoArmazenamento } from '@/infrastructure/modoArmazenamento'
import { SHEET_HEADERS } from '@/domain/sheetsSchema'
import { clearLocalSheets, ensureLocalSheetsWithHeaders } from '@/infrastructure/sheets/localSheets'
import { appendValues } from '@/infrastructure/sheets/gatewayRouter'
import { buildContentXml, buildOdsBytes } from '@/infrastructure/ods/odsWriter'
import { gerarPlanilhaOds, nomeArquivoOds } from '@/application/exportar'

afterEach(() => {
  clearLocalSheets()
  setModoArmazenamento(MODO_GOOGLE)
})

describe('nomeArquivoOds', () => {
  it('gera um slug ASCII com a data', () => {
    expect(nomeArquivoOds('Minhas Ações — Carteira', '2026-10-15T09:30:00.000Z')).toBe(
      'minhas-acoes-carteira-2026-10-15.ods',
    )
  })

  it('usa um nome padrão quando o título não tem caracteres aproveitáveis', () => {
    expect(nomeArquivoOds('—', '2026-10-15T09:30:00.000Z')).toBe('minhas-acoes-2026-10-15.ods')
  })
})

describe('gerarPlanilhaOds (modo local)', () => {
  it('exporta o cabeçalho e as linhas de todas as abas do schema', async () => {
    setModoArmazenamento(MODO_LOCAL)
    ensureLocalSheetsWithHeaders()
    await appendValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A1", [['a1', '2026-01-05', 'Compra']])

    const abas = await gerarPlanilhaOds({ accessToken: 'local', spreadsheetId: WORKSPACE_LOCAL_ID })

    expect(abas.map((aba) => aba.nome)).toEqual([
      'Operacoes',
      'Proventos',
      'Consolidado',
      'Metas_Rebalanceamento',
      'Historico',
      'Valuation',
      'Ativos',
      'Configuracoes',
    ])

    const operacoes = abas[0]
    expect(operacoes.valores[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(operacoes.valores[1]?.slice(0, 3)).toEqual(['a1', '2026-01-05', 'Compra'])
  })

  it('gera um .ods com o conteúdo exportado', async () => {
    setModoArmazenamento(MODO_LOCAL)
    ensureLocalSheetsWithHeaders()
    await appendValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A1", [['a1', 'PETR4']])

    const abas = await gerarPlanilhaOds({ accessToken: 'local', spreadsheetId: WORKSPACE_LOCAL_ID })
    const xml = buildContentXml(abas)

    expect(xml).toContain('table:name="Operacoes"')
    expect(xml).toContain('<text:p>PETR4</text:p>')
    expect(buildOdsBytes(abas).length).toBeGreaterThan(0)
  })
})
