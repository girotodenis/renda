import { describe, expect, it } from 'vitest'
import { lerQuotaDosHeaders } from '@/infrastructure/cotacoes/quota'

/** Testes da leitura dos headers de cota (`RateLimit-*`) das APIs de cotação. */

function headers(valores: Record<string, string>): Headers {
  return new Headers(valores)
}

describe('lerQuotaDosHeaders', () => {
  it('lê os headers RateLimit da Brapi', () => {
    expect(
      lerQuotaDosHeaders(
        headers({
          'ratelimit-limit': '15000',
          'ratelimit-remaining': '14987',
          'ratelimit-reset': '3600',
        }),
      ),
    ).toEqual({ limite: 15000, restante: 14987, reinicioEmSegundos: 3600 })
  })

  it('aceita o prefixo X-RateLimit', () => {
    expect(
      lerQuotaDosHeaders(
        headers({ 'x-ratelimit-limit': '500', 'x-ratelimit-remaining': '42' }),
      ),
    ).toEqual({ limite: 500, restante: 42, reinicioEmSegundos: null })
  })

  it('usa Retry-After como reinício quando não há RateLimit-Reset', () => {
    expect(lerQuotaDosHeaders(headers({ 'retry-after': '30' }))).toEqual({
      limite: null,
      restante: null,
      reinicioEmSegundos: 30,
    })
  })

  it('converte uma data HTTP em segundos restantes', () => {
    const emUmaHora = new Date(Date.now() + 60 * 60 * 1000).toUTCString()
    const quota = lerQuotaDosHeaders(headers({ 'ratelimit-reset': emUmaHora }))
    expect(quota?.reinicioEmSegundos).toBeGreaterThan(3500)
    expect(quota?.reinicioEmSegundos).toBeLessThanOrEqual(3600)
  })

  it('retorna null quando a API não informa cota', () => {
    expect(lerQuotaDosHeaders(headers({ 'content-type': 'application/json' }))).toBeNull()
    expect(lerQuotaDosHeaders(headers({ 'ratelimit-limit': 'abc' }))).toBeNull()
  })
})
