import { describe, expect, it } from 'vitest'
import { columnIndexFromLetters, parseA1Range } from '@/infrastructure/sheets/a1'

describe('columnIndexFromLetters', () => {
  it('converte letras simples em índice 0-based', () => {
    expect(columnIndexFromLetters('A')).toBe(0)
    expect(columnIndexFromLetters('L')).toBe(11)
    expect(columnIndexFromLetters('Z')).toBe(25)
  })

  it('converte letras compostas', () => {
    expect(columnIndexFromLetters('AA')).toBe(26)
    expect(columnIndexFromLetters('AB')).toBe(27)
  })
})

describe('parseA1Range', () => {
  it('interpreta aba citada com intervalo aberto no fim', () => {
    expect(parseA1Range("'Operacoes'!A1:L")).toEqual({
      sheetName: 'Operacoes',
      startRow: 0,
      startColumn: 0,
      endRow: null,
      endColumn: 11,
    })
  })

  it('interpreta intervalo com linha final', () => {
    expect(parseA1Range("'Operacoes'!A2:L5")).toMatchObject({
      startRow: 1,
      startColumn: 0,
      endRow: 4,
      endColumn: 11,
    })
  })

  it('interpreta célula única (usada pelo append)', () => {
    expect(parseA1Range("'Proventos'!A1")).toEqual({
      sheetName: 'Proventos',
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    })
  })

  it('interpreta a primeira linha do cabeçalho', () => {
    expect(parseA1Range("'Metas_Rebalanceamento'!A1:J1")).toMatchObject({
      sheetName: 'Metas_Rebalanceamento',
      startRow: 0,
      endRow: 0,
      endColumn: 9,
    })
  })

  it('aceita intervalo sem nome de aba', () => {
    expect(parseA1Range('B2:D3')).toMatchObject({
      sheetName: '',
      startRow: 1,
      startColumn: 1,
      endRow: 2,
      endColumn: 3,
    })
  })

  it('devolve null para endereços inválidos', () => {
    expect(parseA1Range('')).toBeNull()
    expect(parseA1Range("'Aba'!$A$1")).toBeNull()
    expect(parseA1Range("'Aba'!L2:A1")).toBeNull()
    expect(parseA1Range("'Aba'!L5:A2")).toBeNull()
  })
})
