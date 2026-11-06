import type { QuotaProvedor } from '@/domain/provedoresCotacao'

/**
 * Leitura da **cota** (rate limit) devolvida nos headers das APIs de cotação.
 *
 * A Brapi documenta `RateLimit-Limit`, `RateLimit-Remaining` e
 * `RateLimit-Reset` em toda resposta; provedores que seguem o mesmo padrão
 * (`X-RateLimit-*`) também são reconhecidos. Quando nenhum header existe, o
 * resultado é `null` — a tela mostra apenas "não informado".
 */

/** Converte um header numérico em inteiro ≥ 0 (`null` quando inválido). */
function inteiro(valor: string | null): number | null {
  if (valor === null) return null
  const texto = valor.trim()
  if (texto.length === 0) return null
  const numero = Number(texto)
  if (!Number.isFinite(numero) || numero < 0) return null
  return Math.floor(numero)
}

/**
 * Normaliza `RateLimit-Reset` para segundos restantes.
 *
 * O padrão aceita tanto o delta em segundos (`60`) quanto uma data HTTP. Um
 * valor muito grande (> 1 ano em segundos) só pode ser uma data em segundos
 * desde a epoch, então também é convertido.
 */
function segundosAte(valor: string | null): number | null {
  const numero = inteiro(valor)
  if (numero !== null) {
    if (numero > 366 * 24 * 60 * 60) {
      const diferenca = Math.round(numero - Date.now() / 1000)
      return diferenca > 0 ? diferenca : 0
    }
    return numero
  }
  if (valor === null) return null
  const data = Date.parse(valor)
  if (Number.isNaN(data)) return null
  const diferenca = Math.round((data - Date.now()) / 1000)
  return diferenca > 0 ? diferenca : 0
}

/** Primeiro header existente entre os nomes informados. */
function header(headers: Headers, nomes: readonly string[]): string | null {
  for (const nome of nomes) {
    const valor = headers.get(nome)
    if (valor !== null && valor.trim().length > 0) return valor
  }
  return null
}

/**
 * Extrai a cota da resposta. `Retry-After` entra como "reinício" quando a API
 * responde 429 sem `RateLimit-Reset`.
 */
export function lerQuotaDosHeaders(headers: Headers): QuotaProvedor | null {
  const limite = inteiro(
    header(headers, ['ratelimit-limit', 'x-ratelimit-limit', 'x-rate-limit-limit']),
  )
  const restante = inteiro(
    header(headers, ['ratelimit-remaining', 'x-ratelimit-remaining', 'x-rate-limit-remaining']),
  )
  const reinicioEmSegundos =
    segundosAte(header(headers, ['ratelimit-reset', 'x-ratelimit-reset', 'x-rate-limit-reset'])) ??
    segundosAte(headers.get('retry-after'))

  if (limite === null && restante === null && reinicioEmSegundos === null) return null
  return { limite, restante, reinicioEmSegundos }
}
