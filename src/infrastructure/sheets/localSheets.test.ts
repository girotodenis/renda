import { beforeEach, describe, expect, it } from 'vitest'
import { SHEET_HEADERS, SHEET_NAMES } from '@/domain/sheetsSchema'
import { ChaveIncorretaError, ChaveNecessariaError, criarSessao } from '@/infrastructure/cripto/envelope'
import { guardarChave, _resetChavesForTests } from '@/infrastructure/cripto/chaveSessao'
import {
  ID_COFRE_LOCAL,
  criarCofreLocal,
  removerCofreLocal,
  temCofreLocal,
} from '@/infrastructure/cripto/localCofre'
import { _resetForTests, kvGet, kvSet } from '@/infrastructure/kvStore'
import { parseA1Range } from '@/infrastructure/sheets/a1'
import {
  clearSheetRange,
  ensureLocalSheetsWithHeaders,
  readLocalSheet,
  readSheetRange,
  writeLocalSheet,
  writeSheetRange,
} from '@/infrastructure/sheets/localSheets'

/**
 * Testes do armazenamento das abas locais.
 *
 * O IndexedDB é substituído pelo espelho em memória do `kvStore` (ambiente
 * `node`). As iterações do PBKDF2 ficam em 1.000 para não pesar a suíte.
 */

const SENHA = 'senha de teste'
const CHAVE_ABA = 'local-sheet::Operacoes'

function endereco(range: string) {
  const address = parseA1Range(range)
  if (!address) throw new Error(`Intervalo inválido no teste: ${range}`)
  return address
}

async function sessaoDeTeste() {
  return criarSessao(SENHA, { iteracoes: 1000 })
}

async function cofreDesbloqueado() {
  const sessao = await sessaoDeTeste()
  await criarCofreLocal(sessao)
  guardarChave(ID_COFRE_LOCAL, sessao)
  return sessao
}

beforeEach(() => {
  _resetForTests()
  _resetChavesForTests()
})

describe('banco em claro (sem cofre)', () => {
  it('grava a matriz pura, exatamente como antes da Fase 6', async () => {
    await writeLocalSheet('Operacoes', [[...SHEET_HEADERS.Operacoes], ['a1', 'PETR4']])

    const persistido = kvGet<unknown>('sheets', CHAVE_ABA)
    expect(Array.isArray(persistido)).toBe(true)
    expect(persistido).toEqual([[...SHEET_HEADERS.Operacoes], ['a1', 'PETR4']])
    await expect(readLocalSheet('Operacoes')).resolves.toEqual([
      [...SHEET_HEADERS.Operacoes],
      ['a1', 'PETR4'],
    ])
  })

  it('devolve lista vazia para aba inexistente e remove linhas vazias do fim', async () => {
    await expect(readLocalSheet('Metas_Rebalanceamento')).resolves.toEqual([])

    await writeLocalSheet('Proventos', [['ID'], [null, ''], ['']])

    expect(kvGet('sheets', 'local-sheet::Proventos')).toEqual([['ID']])
  })

  it('lê intervalos recortados e limpa células', async () => {
    await writeLocalSheet('Consolidado', [
      ['Ticker', 'Categoria', 'Valor'],
      ['PETR4', 'Acao', 100],
    ])

    await expect(readSheetRange('Consolidado', endereco("'Consolidado'!A1:B2"))).resolves.toEqual([
      ['Ticker', 'Categoria'],
      ['PETR4', 'Acao'],
    ])

    // Limpar todas as linhas com conteúdo deixa a aba vazia (linhas do fim somem).
    await clearSheetRange('Consolidado', endereco("'Consolidado'!A1:C2"))
    expect(kvGet('sheets', 'local-sheet::Consolidado')).toEqual([])
  })

  it('cria as abas do schema com cabeçalho e é idempotente', async () => {
    expect(await ensureLocalSheetsWithHeaders()).toBe(SHEET_NAMES.length)
    expect(await ensureLocalSheetsWithHeaders()).toBe(0)

    expect(kvGet('sheets', 'local-sheet::Operacoes')).toEqual([[...SHEET_HEADERS.Operacoes]])
  })
})

describe('banco cifrado (cofre ativo)', () => {
  it('nunca grava em claro quando o cofre está ativo e a sessão bloqueada', async () => {
    await criarCofreLocal(await sessaoDeTeste())

    await expect(writeLocalSheet('Operacoes', [['a1', 'PETR4']])).rejects.toBeInstanceOf(
      ChaveNecessariaError,
    )
    expect(kvGet('sheets', CHAVE_ABA)).toBeUndefined()
  })

  it('persiste um envelope e nenhum texto legível das células', async () => {
    await cofreDesbloqueado()
    await writeLocalSheet('Operacoes', [[...SHEET_HEADERS.Operacoes], ['a1', 'TICKER-SECRETO']])

    const persistido = kvGet<unknown>('sheets', CHAVE_ABA)
    expect(persistido).toMatchObject({ v: 1 })
    expect(typeof (persistido as { iv?: unknown }).iv).toBe('string')
    expect(typeof (persistido as { dados?: unknown }).dados).toBe('string')

    const serializado = JSON.stringify(persistido)
    expect(serializado).not.toContain('TICKER-SECRETO')
    expect(serializado).not.toContain('Data')
  })

  it('faz round-trip com a chave da sessão', async () => {
    await cofreDesbloqueado()
    const matriz = [[...SHEET_HEADERS.Operacoes], ['a1', '2026-01-05', 'Compra', 'Acao', 'PETR4']]

    await writeLocalSheet('Operacoes', matriz)

    await expect(readLocalSheet('Operacoes')).resolves.toEqual(matriz)
  })

  it('gera envelope diferente a cada gravação (IV novo)', async () => {
    await cofreDesbloqueado()
    const matriz = [['a1', 'PETR4']]

    await writeLocalSheet('Operacoes', matriz)
    const primeiro = kvGet<unknown>('sheets', CHAVE_ABA)
    await writeLocalSheet('Operacoes', matriz)
    const segundo = kvGet<unknown>('sheets', CHAVE_ABA)

    expect(primeiro).not.toEqual(segundo)
    await expect(readLocalSheet('Operacoes')).resolves.toEqual(matriz)
  })

  it('recusa leitura sem chave na sessão', async () => {
    await cofreDesbloqueado()
    await writeLocalSheet('Operacoes', [['a1', 'PETR4']])
    _resetChavesForTests()

    await expect(readLocalSheet('Operacoes')).rejects.toBeInstanceOf(ChaveNecessariaError)
  })

  it('recusa abas em claro quando o cofre já está ativo', async () => {
    await writeLocalSheet('Operacoes', [['a1', 'PETR4']])
    await cofreDesbloqueado()

    await expect(readLocalSheet('Operacoes')).rejects.toBeInstanceOf(ChaveNecessariaError)
  })

  it('recusa envelope de outra aba (AAD é a chave do registro)', async () => {
    await cofreDesbloqueado()
    await writeLocalSheet('Operacoes', [['a1', 'PETR4']])
    // Cópia manual do envelope para outra aba: a tag não valida.
    const envelope = kvGet<unknown>('sheets', CHAVE_ABA)
    await writeLocalSheet('Proventos', [['p1']])
    kvSet('sheets', 'local-sheet::Proventos', envelope)

    await expect(readLocalSheet('Proventos')).rejects.toBeInstanceOf(ChaveIncorretaError)
  })

  it('cria e completa cabeçalhos já cifrados, de forma idempotente', async () => {
    await cofreDesbloqueado()

    expect(await ensureLocalSheetsWithHeaders()).toBe(SHEET_NAMES.length)
    expect(await ensureLocalSheetsWithHeaders()).toBe(0)
    expect(temCofreLocal()).toBe(true)

    for (const nome of SHEET_NAMES) {
      expect((await readLocalSheet(nome))[0]).toEqual([...SHEET_HEADERS[nome]])
    }
  })

  it('volta a gravar matriz pura depois de remover o cofre', async () => {
    await cofreDesbloqueado()
    await writeLocalSheet('Operacoes', [['a1', 'PETR4']])

    removerCofreLocal()
    await writeLocalSheet('Operacoes', [['a2', 'VALE3']])

    expect(kvGet('sheets', CHAVE_ABA)).toEqual([['a2', 'VALE3']])
    expect(temCofreLocal()).toBe(false)
  })
})

describe('escrita por intervalo no banco cifrado', () => {
  it('preserva o resto da aba ao escrever um intervalo', async () => {
    await cofreDesbloqueado()
    await writeLocalSheet('Operacoes', [[...SHEET_HEADERS.Operacoes], ['a1', 'PETR4']])

    await writeSheetRange('Operacoes', endereco("'Operacoes'!A2:B2"), [['a9', 'VALE3']])

    const linhas = await readLocalSheet('Operacoes')
    expect(linhas[0]).toEqual([...SHEET_HEADERS.Operacoes])
    expect(linhas[1]).toEqual(['a9', 'VALE3'])
  })
})
