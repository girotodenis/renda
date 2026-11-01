import { describe, expect, it } from 'vitest'
import { calcularFluxoCaixaLivre } from '@/domain/fcl'
import type { FclInputs } from '@/domain/fcl'

/**
 * Testes do Fluxo de Caixa Livre (FCL).
 *
 * Cenário base: caixa operacional de R$ 15 bi, capex de imobilizado de R$ 3 bi
 * e de intangível de R$ 1 bi (todos em centavos).
 */

const base: FclInputs = {
  caixaOperacional: 15_000_000_000_00,
  capexImobilizado: 3_000_000_000_00,
  capexIntangivel: 1_000_000_000_00,
}

describe('calcularFluxoCaixaLivre', () => {
  it('subtrai o capex total do caixa operacional', () => {
    const resultado = calcularFluxoCaixaLivre(base)

    expect(resultado).not.toBeNull()
    expect(resultado?.caixaOperacional).toBe(15_000_000_000_00)
    expect(resultado?.capexTotal).toBe(4_000_000_000_00)
    expect(resultado?.fluxoCaixaLivre).toBe(11_000_000_000_00)
  })

  it('trata capex zerado como FCL igual ao caixa operacional', () => {
    const resultado = calcularFluxoCaixaLivre({
      caixaOperacional: 1_000_00,
      capexImobilizado: 0,
      capexIntangivel: 0,
    })

    expect(resultado?.capexTotal).toBe(0)
    expect(resultado?.fluxoCaixaLivre).toBe(1_000_00)
  })

  it('permite FCL negativo quando o capex supera o caixa operacional', () => {
    const resultado = calcularFluxoCaixaLivre({
      ...base,
      caixaOperacional: 1_000_00,
      capexImobilizado: 5_000_00,
      capexIntangivel: 0,
    })

    expect(resultado?.fluxoCaixaLivre).toBe(-4_000_00)
  })

  it('retorna null para entradas inválidas', () => {
    expect(calcularFluxoCaixaLivre({ ...base, caixaOperacional: 0 })).toBeNull()
    expect(calcularFluxoCaixaLivre({ ...base, caixaOperacional: -1 })).toBeNull()
    expect(calcularFluxoCaixaLivre({ ...base, capexImobilizado: -1 })).toBeNull()
    expect(calcularFluxoCaixaLivre({ ...base, capexIntangivel: -1 })).toBeNull()
    expect(calcularFluxoCaixaLivre({ ...base, caixaOperacional: Number.NaN })).toBeNull()
    expect(
      calcularFluxoCaixaLivre({ ...base, capexIntangivel: Number.POSITIVE_INFINITY }),
    ).toBeNull()
  })
})
