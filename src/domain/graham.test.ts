import { describe, expect, it } from 'vitest'
import { calcularPrecoGraham } from '@/domain/graham'

/**
 * Testes do Preço Justo de Graham (Graham Number):
 * `V = √(22,5 × LPA × VPA)`.
 */

describe('calcularPrecoGraham', () => {
  it('calcula LPA R$ 5,00 e VPA R$ 40,00 → R$ 67,08', () => {
    // 22,5 × 5 × 40 = 4500 → √4500 ≈ 67,082 → 6708 centavos.
    expect(calcularPrecoGraham({ lpa: 500, vpa: 4000 })).toBe(6708)
  })

  it('LPA e VPA iguais a 1 real → √22,5 ≈ R$ 4,74', () => {
    // √(22,5 × 100 × 100) = √225000 = 474,34 → 474 centavos.
    expect(calcularPrecoGraham({ lpa: 100, vpa: 100 })).toBe(474)
  })

  it('retorna null para LPA ou VPA zerados', () => {
    expect(calcularPrecoGraham({ lpa: 0, vpa: 4000 })).toBeNull()
    expect(calcularPrecoGraham({ lpa: 500, vpa: 0 })).toBeNull()
  })

  it('retorna null para valores negativos ou não finitos', () => {
    expect(calcularPrecoGraham({ lpa: -100, vpa: 4000 })).toBeNull()
    expect(calcularPrecoGraham({ lpa: Number.NaN, vpa: 4000 })).toBeNull()
  })
})
