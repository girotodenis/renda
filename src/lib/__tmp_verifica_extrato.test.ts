import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analisarExtratoB3 } from '@/lib/b3Import'

describe('verificação do extrato gerado', () => {
  it('importa as 19 operações sem linhas ignoradas', () => {
    const texto = readFileSync('extrato-b3-tgar11.csv', 'utf8')
    const resultado = analisarExtratoB3(texto)
    expect(resultado.formato).toBe('movimentacao')
    expect(resultado.operacoes).toHaveLength(19)
    expect(resultado.proventos).toHaveLength(0)
    expect(resultado.ignorados).toHaveLength(0)
    expect(resultado.operacoes[0]).toMatchObject({
      ticker: 'TGAR11',
      tipo: 'Compra',
      quantidade: 1,
      precoUnitario: 5041,
      data: '2026-07-16',
    })
    expect(resultado.operacoes[1]).toMatchObject({
      ticker: 'TGAR11',
      tipo: 'Venda',
      quantidade: 23,
      precoUnitario: 7098,
    })
    expect(resultado.operacoes[18]).toMatchObject({
      tipo: 'Compra',
      quantidade: 21,
      precoUnitario: 11200,
      data: '2023-09-23',
    })
  })
})
