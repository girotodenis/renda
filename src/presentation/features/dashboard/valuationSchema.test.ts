import { describe, expect, it } from 'vitest'
import {
  fclFormSchema,
  valuationFormSchema,
  toValuationPayload,
} from '@/presentation/features/dashboard/valuationSchema'
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

describe('fclFormSchema', () => {
  it('converte caixa operacional e capex em centavos', () => {
    const parsed = fclFormSchema.safeParse({
      caixaOperacional: '15.000.000.000,00',
      capexImobilizado: '3.000.000.000,00',
      capexIntangivel: '1.000.000.000,00',
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.caixaOperacional).toBe(15_000_000_000_00)
    expect(parsed.data.capexImobilizado).toBe(3_000_000_000_00)
    expect(parsed.data.capexIntangivel).toBe(1_000_000_000_00)
  })

  it('trata capex vazio como zero', () => {
    const parsed = fclFormSchema.safeParse({
      caixaOperacional: '1.000,00',
      capexImobilizado: '',
      capexIntangivel: undefined,
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.capexImobilizado).toBe(0)
    expect(parsed.data.capexIntangivel).toBe(0)
  })

  it('exige o caixa operacional', () => {
    const parsed = fclFormSchema.safeParse({
      caixaOperacional: '',
      capexImobilizado: '0',
      capexIntangivel: '0',
    })

    expect(parsed.success).toBe(false)
  })

  it('recusa caixa operacional zero/negativo e capex negativo', () => {
    expect(
      fclFormSchema.safeParse({
        caixaOperacional: '0',
        capexImobilizado: '0',
        capexIntangivel: '0',
      }).success,
    ).toBe(false)
    expect(
      fclFormSchema.safeParse({
        caixaOperacional: '100,00',
        capexImobilizado: '-10,00',
        capexIntangivel: '0',
      }).success,
    ).toBe(false)
  })
})
