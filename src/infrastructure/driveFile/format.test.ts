import { describe, expect, it } from 'vitest'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import {
  DATABASE_FILE_VERSION,
  DatabaseFileError,
  decodeDatabaseFile,
  emptyDatabase,
  encodeDatabaseFile,
  needsNormalization,
  normalizeDatabaseFile,
} from '@/infrastructure/driveFile/format'
import type { DatabaseSheets } from '@/infrastructure/driveFile/format'
import type { CellValue } from '@/infrastructure/sheets/sheetCells'
import { configDeRegistros, registrosDeConfig } from '@/domain/configuracoes'

const encoder = new TextEncoder()

/** Banco completo com todas as abas, sobrescrevendo apenas o que o teste precisa. */
function sheetsWith(overrides: Partial<DatabaseSheets> = {}): DatabaseSheets {
  return { ...emptyDatabase().sheets, ...overrides }
}

describe('emptyDatabase', () => {
  it('cria as abas do schema só com a linha de cabeçalho', () => {
    const banco = emptyDatabase()

    expect(banco.version).toBe(DATABASE_FILE_VERSION)
    expect(Object.keys(banco.sheets)).toEqual([...SHEET_NAMES])
    for (const name of SHEET_NAMES) {
      expect(banco.sheets[name]).toEqual([[...SHEET_HEADERS[name]]])
    }
  })
})

describe('encodeDatabaseFile + decodeDatabaseFile', () => {
  it('faz round-trip preservando abas e valores (acentos, números, booleanos e null)', async () => {
    const sheets = sheetsWith({
      Operacoes: [
        [...SHEET_HEADERS.Operacoes],
        ['op-1', '2026-01-05', 'Compra', 'Ações', 'PETR4', 100, 38.42, 4.9, null, null, null, 3842],
      ],
      Configuracoes: [
        [...SHEET_HEADERS.Configuracoes],
        ['tema', 'Ação/Órgão'],
        ['notificacoes', true],
        ['limite', 0],
      ],
    })

    const bytes = await encodeDatabaseFile(sheets)
    const decodificado = await decodeDatabaseFile(bytes)

    expect(decodificado.version).toBe(DATABASE_FILE_VERSION)
    expect(Object.keys(decodificado.sheets)).toEqual([...SHEET_NAMES])
    expect(decodificado.sheets.Operacoes).toEqual(sheets.Operacoes)
    expect(decodificado.sheets.Configuracoes).toEqual(sheets.Configuracoes)
  })

  it('decodifica um arquivo sem compressão (fallback do compression.ts)', async () => {
    const sheets = sheetsWith({
      Historico: [
        [...SHEET_HEADERS.Historico],
        ['2026-02-01', 150000.5, 120000, 30000.5],
      ],
    })

    const cru = encoder.encode(JSON.stringify({ version: 1, sheets }))
    const decodificado = await decodeDatabaseFile(cru)

    expect(decodificado.version).toBe(1)
    expect(decodificado.sheets.Historico).toEqual(sheets.Historico)
  })

  it('preserva os tokens de todas as integrações na aba Configuracoes do banco JSON', async () => {
    const tokens = { brapi: 'token-brapi', maisretorno: 'mr_abc_123' }
    const sheets = sheetsWith({
      Configuracoes: [
        [...SHEET_HEADERS.Configuracoes],
        ...registrosDeConfig({ tokens }).map(({ chave, valor }) => [chave, valor]),
      ],
    })

    const decodificado = await decodeDatabaseFile(await encodeDatabaseFile(sheets))
    const registros = decodificado.sheets.Configuracoes
      .slice(1)
      .map(([chave, valor]) => ({ chave: String(chave), valor: String(valor) }))

    expect(configDeRegistros(registros).tokens).toEqual(tokens)
  })

  it('lança DatabaseFileError em JSON inválido', async () => {
    const invalido = encoder.encode('não é json')

    await expect(decodeDatabaseFile(invalido)).rejects.toBeInstanceOf(DatabaseFileError)
    await expect(decodeDatabaseFile(invalido)).rejects.toThrow('não foi possível ler o JSON')
  })
})

describe('normalizeDatabaseFile', () => {
  it('completa a aba ausente com o cabeçalho do schema', () => {
    const sheets: Record<string, unknown> = { ...emptyDatabase().sheets }
    delete sheets.Historico

    const normalizado = normalizeDatabaseFile({ version: 1, sheets })

    expect(normalizado.sheets.Historico).toEqual([[...SHEET_HEADERS.Historico]])
    expect(Object.keys(normalizado.sheets)).toEqual([...SHEET_NAMES])
  })

  it('estende um cabeçalho parcial preservando o que já existia e as linhas de dados', () => {
    const normalizado = normalizeDatabaseFile({
      version: 1,
      sheets: sheetsWith({
        Operacoes: [['ID', 'Data'], ['op-1', '2026-01-05']],
      }),
    })

    expect(normalizado.sheets.Operacoes[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(normalizado.sheets.Operacoes[1]).toEqual(['op-1', '2026-01-05'])
  })

  it('preserva cabeçalho editado pelo usuário e colunas extras no fim', () => {
    const cabecalhoEditado = [
      'Código',
      'Data',
      'Tipo',
      'Categoria',
      'Ativo',
      'Qtd',
      'Preço Unitário',
      'Taxas',
      'Indexador',
      '% do Indexador',
      'Vencimento',
      'Valor Bruto Atual',
      'Observações',
    ]

    const normalizado = normalizeDatabaseFile({
      version: 1,
      sheets: sheetsWith({
        Operacoes: [cabecalhoEditado, ['op-1', '2026-01-05', 'Compra']],
      }),
    })

    expect(normalizado.sheets.Operacoes[0]).toEqual(cabecalhoEditado)
    expect(normalizado.sheets.Operacoes[1]).toEqual(['op-1', '2026-01-05', 'Compra'])
  })

  it('preserva os nomes editados e só estende o sufixo que falta', () => {
    const normalizado = normalizeDatabaseFile({
      version: 1,
      sheets: sheetsWith({
        Operacoes: [['Código', 'Data', 'Operação']],
      }),
    })

    expect(normalizado.sheets.Operacoes[0]).toEqual([
      'Código',
      'Data',
      'Operação',
      ...SHEET_HEADERS.Operacoes.slice(3),
    ])
  })

  it('assume a versão atual quando a versão está ausente', () => {
    const normalizado = normalizeDatabaseFile({ sheets: emptyDatabase().sheets })

    expect(normalizado.version).toBe(DATABASE_FILE_VERSION)
  })

  it('rejeita banco de versão mais nova com mensagem amigável', () => {
    const executar = () => normalizeDatabaseFile({ version: 99, sheets: emptyDatabase().sheets })

    expect(executar).toThrow(DatabaseFileError)
    expect(executar).toThrow(
      'Este banco de dados foi criado por uma versão mais nova do app. Atualize o app para continuar.',
    )
  })

  it('rejeita Sheets ausente ou que não seja objeto', () => {
    expect(() => normalizeDatabaseFile(null)).toThrow(DatabaseFileError)
    expect(() => normalizeDatabaseFile({ version: 1 })).toThrow(DatabaseFileError)
    expect(() => normalizeDatabaseFile({ version: 1, sheets: [] })).toThrow(DatabaseFileError)
  })

  it('converte células inválidas em null e descarta abas extras', () => {
    const normalizado = normalizeDatabaseFile({
      version: 1,
      sheets: {
        ...emptyDatabase().sheets,
        Operacoes: [
          [...SHEET_HEADERS.Operacoes],
          ['op-1', { x: 1 }, undefined, Number.NaN, Number.POSITIVE_INFINITY, true],
          'linha inválida',
          ['op-2', null, false, 0],
        ],
        AbaAntiga: [['lixo']],
      },
    })

    expect(Object.keys(normalizado.sheets)).toEqual([...SHEET_NAMES])
    expect(normalizado.sheets.Operacoes[1]).toEqual(['op-1', null, null, null, null, true])
    expect(normalizado.sheets.Operacoes[2]).toEqual(['op-2', null, false, 0])
    expect(normalizado.sheets.Operacoes).toHaveLength(3)
  })

  it('não muta o objeto recebido', () => {
    const operacoes: CellValue[][] = [['ID', 'Data'], ['op-1', '2026-01-05']]
    const raw = { version: 1, sheets: sheetsWith({ Operacoes: operacoes }) }
    const antes = JSON.stringify(raw)

    normalizeDatabaseFile(raw)

    expect(JSON.stringify(raw)).toBe(antes)
  })
})

describe('needsNormalization', () => {
  it('é false para um banco completo', () => {
    expect(needsNormalization(emptyDatabase())).toBe(false)
    expect(needsNormalization(JSON.parse(JSON.stringify(emptyDatabase())))).toBe(false)
  })

  it('é true quando falta uma aba', () => {
    const sheets: Record<string, unknown> = { ...emptyDatabase().sheets }
    delete sheets.Valuation

    expect(needsNormalization({ version: 1, sheets })).toBe(true)
  })

  it('é true quando o cabeçalho está incompleto', () => {
    expect(
      needsNormalization({
        version: 1,
        sheets: sheetsWith({ Proventos: [['ID', 'Data Com']] }),
      }),
    ).toBe(true)
  })

  it('é true com abas extras, células inválidas ou versão ausente', () => {
    const extra = {
      version: 1,
      sheets: { ...emptyDatabase().sheets, AbaAntiga: [['lixo']] },
    }
    const invalida = {
      version: 1,
      sheets: {
        ...emptyDatabase().sheets,
        Operacoes: [[...SHEET_HEADERS.Operacoes], ['op-1', { x: 1 }]],
      },
    }
    const semVersao = { sheets: emptyDatabase().sheets }

    expect(needsNormalization(extra)).toBe(true)
    expect(needsNormalization(invalida)).toBe(true)
    expect(needsNormalization(semVersao)).toBe(true)
  })

  it('é true para entradas que nem são objetos', () => {
    expect(needsNormalization(null)).toBe(true)
    expect(needsNormalization('texto')).toBe(true)
  })
})
