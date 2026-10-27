import { describe, expect, it } from 'vitest'
import { calcularFluxoDescontado } from '@/domain/dcf'
import type { DcfInputs } from '@/domain/dcf'

/**
 * Testes do Fluxo de Caixa Descontado (FCD).
 *
 * Cenário base: FCL de R$ 10 bi, dívida líquida de R$ 2 bi, 500 mi de ações,
 * crescimento de 10% a.a., desconto de 12% a.a., 5 anos e perpetuidade de 3%.
 */

const base: DcfInputs = {
  fclAtual: 10_000_000_000_00, // R$ 10.000.000.000,00 em centavos
  dividaLiquida: 2_000_000_000_00,
  acoesMilhoes: 500,
  crescimentoAno: 10,
  taxaDesconto: 12,
  anosProjecao: 5,
  crescimentoPerpetuidade: 3,
}

describe('calcularFluxoDescontado', () => {
  it('projeta os fluxos e calcula o preço justo por ação', () => {
    const resultado = calcularFluxoDescontado(base)

    expect(resultado).not.toBeNull()
    expect(resultado?.fluxos).toHaveLength(5)
    // Primeiro fluxo: 10 bi × 1,10 = 11 bi; VP = 11 bi / 1,12 ≈ 9,821 bi.
    expect(resultado?.fluxos[0]?.fluxo).toBeCloseTo(11_000_000_000_00, -6)
    expect(resultado?.precoJusto).toBeGreaterThan(0)
  })

  it('reduz o preço justo quando a dívida líquida é positiva', () => {
    const comDivida = calcularFluxoDescontado(base)
    const semDivida = calcularFluxoDescontado({ ...base, dividaLiquida: 0 })

    expect(comDivida?.precoJusto).toBeLessThan(semDivida?.precoJusto ?? 0)
  })

  it('aumenta o preço justo quando há caixa líquido (dívida negativa)', () => {
    const comCaixa = calcularFluxoDescontado({ ...base, dividaLiquida: -1_000_000_000_00 })
    expect(comCaixa?.precoJusto).toBeGreaterThan(calcularFluxoDescontado(base)?.precoJusto ?? 0)
  })

  it('retorna null quando a taxa de desconto não supera a perpetuidade', () => {
    expect(calcularFluxoDescontado({ ...base, taxaDesconto: 3, crescimentoPerpetuidade: 3 })).toBeNull()
    expect(calcularFluxoDescontado({ ...base, taxaDesconto: 2, crescimentoPerpetuidade: 3 })).toBeNull()
  })

  it('retorna null para premissas inválidas', () => {
    expect(calcularFluxoDescontado({ ...base, fclAtual: 0 })).toBeNull()
    expect(calcularFluxoDescontado({ ...base, acoesMilhoes: 0 })).toBeNull()
    expect(calcularFluxoDescontado({ ...base, taxaDesconto: 0 })).toBeNull()
    expect(calcularFluxoDescontado({ ...base, anosProjecao: 0 })).toBeNull()
    expect(calcularFluxoDescontado({ ...base, anosProjecao: 2.5 })).toBeNull()
  })
})
