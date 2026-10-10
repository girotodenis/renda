/**
 * Utilidades monetárias.
 *
 * Convenção do projeto: valores monetários trafegam como **centavos inteiros**
 * (`toCentavos`/`fromCentavos`) ou como `number` arredondado explicitamente para
 * 2 casas (`round2`). Nunca comparar floats com `==`.
 */

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const brlInputFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Formata um valor **em reais** como moeda brasileira (ex.: `1234.5` → `"R$ 1.234,50"`).
 */
export function formatarBRL(value: number): string {
  return brlFormatter.format(value)
}

/**
 * Faz o parse tolerante de um número digitado em pt-BR (aceita `1.234,56`,
 * `1234,56` ou `1234.56`). Retorna `null` quando vazio ou inválido.
 */
export function parseDecimalBR(input: string): number | null {
  const cleaned = input.replace(/[R$\s]/g, '').trim()
  if (cleaned.length === 0) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized = cleaned
  if (lastComma > lastDot) {
    // Vírgula é o separador decimal; pontos são milhares.
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma && lastComma !== -1) {
    // Ponto é o separador decimal; vírgulas são milhares.
    normalized = cleaned.replace(/,/g, '')
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/**
 * Faz o parse de um valor monetário digitado em pt-BR, retornando **reais**
 * (ex.: `"1.234,56"` → `1234.56`). Retorna `null` quando vazio ou inválido.
 */
export function parseBRL(input: string): number | null {
  const value = parseDecimalBR(input)
  return value === null ? null : round2(value)
}

/**
 * Formata **centavos** para exibição em um input monetário pt-BR, sem o
 * símbolo da moeda (ex.: `1999` → `"19,99"`).
 */
export function formatMoneyInput(centavos: number): string {
  return brlInputFormatter.format(fromCentavos(centavos))
}

/**
 * Arredonda para 2 casas decimais corrigindo erros de ponto flutuante
 * (ex.: `1.005` → `1.01`).
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Converte um valor **em reais** para **centavos inteiros** (ex.: `19.99` → `1999`).
 */
export function toCentavos(value: number): number {
  return Math.round((value + Number.EPSILON) * 100)
}

/**
 * Converte **centavos inteiros** para um valor **em reais** (ex.: `1999` → `19.99`).
 */
export function fromCentavos(centavos: number): number {
  return round2(centavos / 100)
}
