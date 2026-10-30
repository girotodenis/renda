import { describe, expect, it } from 'vitest'
import { valuationFormSchema, toValuationPayload } from '@/presentation/features/dashboard/valuationSchema'
import { CategoriaAtivo } from '@/domain/entities'

describe('valuationFormSchema', () => {
  it('valida apenas preço teto e margem (demais vazios)', () => {
    const parsed = valuationFormSchema.safeParse({
      precoTeto: '100,00',
      margemSeguranca: '20',
      anotacoes: '',
      fclAtual: '',
      dividaLiquida: '',
      acoesMilhoes: '',
      crescimentoAno: '',
      taxaDesconto: '',
      anosProjecao: '',
      crescimentoPerpetuidade: '',
      lpa: '',
      vpa: '',
    })
    expect(parsed.success).toBe(true)
  })

  it('aceita undefined nos campos opcionais (inputs não montados)', () => {
    const parsed = valuationFormSchema.safeParse({
      precoTeto: '100,00',
      margemSeguranca: '20',
      anotacoes: '',
      fclAtual: undefined,
      dividaLiquida: undefined,
      acoesMilhoes: undefined,
      crescimentoAno: undefined,
      taxaDesconto: undefined,
      anosProjecao: undefined,
      crescimentoPerpetuidade: undefined,
      lpa: undefined,
      vpa: undefined,
    })
    expect(parsed.success).toBe(true)
  })

  it('converte para payload com lpa/vpa null', () => {
    const parsed = valuationFormSchema.safeParse({
      precoTeto: '100,00',
      margemSeguranca: '20',
      anotacoes: '',
      fclAtual: '',
      dividaLiquida: '',
      acoesMilhoes: '',
      crescimentoAno: '',
      taxaDesconto: '',
      anosProjecao: '',
      crescimentoPerpetuidade: '',
      lpa: '',
      vpa: '',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const payload = toValuationPayload(parsed.data, 'PETR4', CategoriaAtivo.Acao)
    expect(payload.precoTeto).toBe(10000)
    expect(payload.lpa).toBeNull()
    expect(payload.vpa).toBeNull()
  })
})
