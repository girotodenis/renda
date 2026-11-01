import { round2 } from '@/domain/money'

/**
 * Cálculo do Fluxo de Caixa Livre (FCL) a partir da Demonstração do Fluxo de
 * Caixa (DFC) — módulo **puro** e testável.
 *
 * `FCL = caixa líquido das atividades operacionais − capex`
 * (aquisições de imobilizado + aquisições de intangível). O resultado é a
 * premissa `fclAtual` consumida pelo FCD (`domain/dcf.ts`).
 *
 * Convenções:
 * - Dinheiro em **centavos**.
 * - O capex é informado como valor **positivo** (é subtraído do caixa).
 */

/** Entradas do cálculo do FCL (valores já validados pela camada de UI). */
export interface FclInputs {
  /** Caixa líquido das atividades operacionais nos últimos 12 meses, em centavos. */
  caixaOperacional: number
  /** Aquisições de imobilizado no período, em centavos (≥ 0). */
  capexImobilizado: number
  /** Aquisições de intangível no período, em centavos (≥ 0). */
  capexIntangivel: number
}

/** Resultado do cálculo do FCL (todos os valores em centavos). */
export interface FclResult {
  /** Caixa líquido das atividades operacionais informado, em centavos. */
  caixaOperacional: number
  /** Capex total (imobilizado + intangível), em centavos. */
  capexTotal: number
  /** Fluxo de caixa livre = caixa operacional − capex total, em centavos. */
  fluxoCaixaLivre: number
}

/**
 * Calcula o FCL. Retorna `null` quando algum valor não é finito, quando o caixa
 * operacional não é positivo ou quando o capex é negativo.
 */
export function calcularFluxoCaixaLivre(inputs: FclInputs): FclResult | null {
  const { caixaOperacional, capexImobilizado, capexIntangivel } = inputs

  if (!Number.isFinite(caixaOperacional) || caixaOperacional <= 0) return null
  if (!Number.isFinite(capexImobilizado) || capexImobilizado < 0) return null
  if (!Number.isFinite(capexIntangivel) || capexIntangivel < 0) return null

  const capexTotal = round2(capexImobilizado + capexIntangivel)

  return {
    caixaOperacional: round2(caixaOperacional),
    capexTotal,
    fluxoCaixaLivre: round2(caixaOperacional - capexTotal),
  }
}
