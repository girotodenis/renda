/**
 * Preço Justo de Graham (Graham Number) — módulo **puro** e testável.
 *
 * Fórmula clássica de Benjamin Graham para estimar o valor justo de uma ação a
 * partir dos fundamentos:
 *
 *   V = √(22,5 × LPA × VPA)
 *
 * onde `22,5` = P/L máximo de 15 × P/VPA máximo de 1,5.
 *
 * Convenção do projeto: dinheiro em **centavos**. Como a raiz de
 * `centavos × centavos` volta para centavos, o resultado já sai em centavos.
 */

/** Entradas do cálculo de Graham (valores já validados pela UI). */
export interface GrahamInputs {
  /** Lucro por ação (LPA), em centavos. */
  lpa: number
  /** Valor patrimonial por ação (VPA), em centavos. */
  vpa: number
}

/**
 * Calcula o preço justo de Graham em **centavos**. Retorna `null` quando algum
 * dos dois valores é inválido (≤ 0 ou não finito).
 */
export function calcularPrecoGraham(inputs: GrahamInputs): number | null {
  const { lpa, vpa } = inputs
  if (!Number.isFinite(lpa) || lpa <= 0) return null
  if (!Number.isFinite(vpa) || vpa <= 0) return null
  return Math.round(Math.sqrt(22.5 * lpa * vpa))
}
