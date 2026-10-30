import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODO_GOOGLE, MODO_LOCAL, WORKSPACE_LOCAL_ID } from '@/domain/armazenamento'
import { SHEET_HEADERS } from '@/domain/sheetsSchema'
import { setModoArmazenamento } from '@/infrastructure/modoArmazenamento'
import { clearLocalSheets, ensureLocalSheetsWithHeaders, readLocalSheet } from '@/infrastructure/sheets/localSheets'
import { updateValues } from '@/infrastructure/sheets/gatewayRouter'
import { buildOdsBytes } from '@/infrastructure/ods/odsWriter'
import { analisarOds, aplicarImportacao, importarOds, ABAS_IMPORTAVEIS } from '@/application/importar'
import { gerarPlanilhaOds } from '@/application/exportar'

const CONTEXTO = { accessToken: 'local', spreadsheetId: WORKSPACE_LOCAL_ID }

/** Linha da aba `Operacoes` no formato do schema (12 colunas). */
const LINHA_COMPRA = [
  'a1',
  '2026-01-05',
  'Compra',
  'Acao',
  'PETR4',
  100,
  32.5,
  0,
  '',
  '',
  '',
  '',
]

beforeEach(() => {
  clearLocalSheets()
  setModoArmazenamento(MODO_LOCAL)
})

afterEach(() => {
  clearLocalSheets()
  setModoArmazenamento(MODO_GOOGLE)
})

describe('analisarOds', () => {
  it('reconhece os nomes das abas de forma tolerante e ignora as desconhecidas', () => {
    const analise = analisarOds([
      { nome: 'operacoes', valores: [[...SHEET_HEADERS.Operacoes], LINHA_COMPRA] },
      { nome: 'Metas Rebalanceamento', valores: [] },
      { nome: 'Consolidado', valores: [['PETR4', 'Acao', 100]] },
      { nome: 'Planilha Qualquer', valores: [['x']] },
    ])

    expect(analise.abas.map((aba) => aba.nome)).toEqual(['Operacoes', 'Metas_Rebalanceamento'])
    expect(analise.temConsolidado).toBe(true)
    expect(analise.desconhecidas).toEqual(['Planilha Qualquer'])
  })

  it('descarta a linha de cabeçalho do arquivo e as linhas vazias do fim', () => {
    const analise = analisarOds([
      {
        nome: 'Operacoes',
        valores: [[...SHEET_HEADERS.Operacoes], LINHA_COMPRA, [null, null], ['']],
      },
    ])

    const linhas = analise.dados.get('Operacoes')
    expect(linhas).toHaveLength(1)
    expect(linhas?.[0]?.[0]).toBe('a1')
  })

  it('mantém os dados quando o arquivo não tem cabeçalho', () => {
    const analise = analisarOds([{ nome: 'Operacoes', valores: [LINHA_COMPRA] }])
    expect(analise.dados.get('Operacoes')).toHaveLength(1)
  })
})

describe('aplicarImportacao (modo local)', () => {
  it('cria as abas, grava os dados e recalcula o Consolidado', async () => {
    const resultado = await aplicarImportacao(CONTEXTO, {
      abas: [{ nome: 'Operacoes', linhas: 1 }],
      desconhecidas: [],
      temConsolidado: false,
      dados: new Map([['Operacoes', [LINHA_COMPRA]]]),
    })

    expect(resultado.linhasConsolidadas).toBe(1)
    // Cabeçalho preservado e dados na linha 2.
    expect(readLocalSheet('Operacoes')[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(readLocalSheet('Operacoes')[1]?.slice(0, 5)).toEqual([
      'a1',
      '2026-01-05',
      'Compra',
      'Acao',
      'PETR4',
    ])
    // A aba derivada é recalculada pelo app, com valores estáticos.
    const consolidado = readLocalSheet('Consolidado')
    expect(consolidado[0]).toEqual([...SHEET_HEADERS.Consolidado])
    expect(consolidado[1]?.[0]).toBe('PETR4')
    expect(consolidado[1]?.[4]).toBe(32.5)
  })

  it('substitui o conteúdo anterior em vez de mesclar', async () => {
    ensureLocalSheetsWithHeaders()
    await updateValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A2:L3", [
      LINHA_COMPRA,
      ['a9', '2026-03-01', 'Compra', 'Acao', 'VALE3', 5, 60, 0, '', '', '', ''],
    ])

    await aplicarImportacao(CONTEXTO, {
      abas: [{ nome: 'Operacoes', linhas: 1 }],
      desconhecidas: [],
      temConsolidado: false,
      dados: new Map([['Operacoes', [LINHA_COMPRA]]]),
    })

    const linhas = readLocalSheet('Operacoes')
    expect(linhas).toHaveLength(2)
    expect(linhas[1]?.[4]).toBe('PETR4')
  })
})

describe('ciclo exportar → importar (modo local)', () => {
  it('recupera os dados a partir do arquivo exportado', async () => {
    ensureLocalSheetsWithHeaders()
    await updateValues('', WORKSPACE_LOCAL_ID, "'Operacoes'!A2:L2", [LINHA_COMPRA])
    await updateValues('', WORKSPACE_LOCAL_ID, "'Proventos'!A2:G2", [
      ['p1', '2026-02-01', '2026-02-15', 'Acao', 'PETR4', 'Dividendo', 12.5],
    ])

    // "Backup": exatamente os bytes que o usuário baixaria.
    const backup = buildOdsBytes(await gerarPlanilhaOds(CONTEXTO))

    // Simula um banco novo/vazio (outro navegador, limpeza de dados…).
    clearLocalSheets()

    const resultado = await importarOds(CONTEXTO, backup)

    // O backup traz as sete abas; `Consolidado` é derivada e não é importada.
    expect(resultado.abas.map((aba) => aba.nome)).toEqual([...ABAS_IMPORTAVEIS])
    expect(readLocalSheet('Operacoes')[1]?.slice(0, 5)).toEqual([
      'a1',
      '2026-01-05',
      'Compra',
      'Acao',
      'PETR4',
    ])
    expect(readLocalSheet('Proventos')[1]?.slice(0, 7)).toEqual([
      'p1',
      '2026-02-01',
      '2026-02-15',
      'Acao',
      'PETR4',
      'Dividendo',
      12.5,
    ])
    expect(resultado.linhasConsolidadas).toBe(1)
    expect(readLocalSheet('Consolidado')[1]?.[0]).toBe('PETR4')
  })
})
