import { describe, expect, it } from 'vitest'
import fixture from '@/domain/fixtures/carteira-sintetica.json'
import { twr, xirr } from '@/domain/performance'
import type { FluxoDatado, Subperiodo } from '@/domain/performance'

/**
 * Regressão numérica em uma série de estresse com a **forma de uma carteira
 * real**: ~9 anos, 409 datas de fluxo e 18 snapshots (datas deslocadas e
 * valores sintéticos, derivados da estrutura de uma carteira real).
 *
 * A referência foi calculada por uma implementação independente (bissecção em
 * Python) sobre o mesmo arquivo. Os construtores
 * (`fluxosParaXirr`/`subperiodosDaCarteira`) têm testes próprios em
 * `performance.test.ts`; aqui o foco é a convergência numérica em série longa.
 */

const fluxosLiquidos = fixture.fluxosLiquidos as unknown as [string, number][]
const snapshots = fixture.snapshots as unknown as [string, number][]

function fluxosParaXirr(): FluxoDatado[] {
  return [
    ...fluxosLiquidos.map(([data, valor]) => ({ data, valor })),
    { data: fixture.dataFinal, valor: fixture.valorFinal },
  ]
}

function subperiodos(): Subperiodo[] {
  const resultado: Subperiodo[] = []
  for (let indice = 1; indice < snapshots.length; indice += 1) {
    const [dataInicial, valorInicial] = snapshots[indice - 1]
    const [dataFinal, valorFinal] = snapshots[indice]

    // No TWR o sinal é o inverso do XIRR: aporte entra (+), resgate sai (−).
    let fluxoLiquido = 0
    for (const [data, valor] of fluxosLiquidos) {
      if (data > dataInicial && data <= dataFinal) fluxoLiquido -= valor
    }

    resultado.push({ dataInicial, dataFinal, valorInicial, valorFinal, fluxoLiquido })
  }
  return resultado
}

describe('desempenho em série longa (sintética, forma de carteira real)', () => {
  it('calcula o XIRR de ~9 anos de fluxos', () => {
    const taxa = xirr(fluxosParaXirr())

    expect(taxa).not.toBeNull()
    expect(taxa!).toBeCloseTo(fixture.referencia.xirr, 6)
  })

  it('calcula o TWR encadeando os snapshots reais', () => {
    const resultado = twr(subperiodos())

    expect(resultado).not.toBeNull()
    expect(resultado!.subperiodos).toBe(17)
    expect(resultado!.acumulado).toBeCloseTo(fixture.referencia.twr, 6)
    expect(resultado!.anualizado!).toBeCloseTo(fixture.referencia.twrAnualizado, 6)
  })
})
