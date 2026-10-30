import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODO_GOOGLE, MODO_LOCAL, WORKSPACE_LOCAL_ID } from '@/domain/armazenamento'
import { setModoArmazenamento } from '@/infrastructure/modoArmazenamento'
import { clearLocalSheets, ensureLocalSheetsWithHeaders, readLocalSheet } from '@/infrastructure/sheets/localSheets'
import { salvarValuation } from '@/application/valuation'
import { CategoriaAtivo } from '@/domain/entities'
import type { Valuation } from '@/domain/entities'

const CONTEXTO = { accessToken: 'local', spreadsheetId: WORKSPACE_LOCAL_ID }

beforeEach(() => {
  clearLocalSheets()
  setModoArmazenamento(MODO_LOCAL)
  ensureLocalSheetsWithHeaders()
})

afterEach(() => {
  clearLocalSheets()
  setModoArmazenamento(MODO_GOOGLE)
})

describe('salvarValuation (modo local)', () => {
  it('salva uma análise completa com FCD e Graham', async () => {
    const valuation: Valuation = {
      ticker: 'PETR4',
      categoria: CategoriaAtivo.Acao,
      precoTeto: 6708,
      margemSeguranca: 20,
      anotacoes: 'teste',
      fclAtual: 10_000_000_000_00,
      dividaLiquida: 2_000_000_000_00,
      acoesMilhoes: 500,
      crescimentoAno: 10,
      taxaDesconto: 12,
      anosProjecao: 5,
      crescimentoPerpetuidade: 3,
      lpa: 500,
      vpa: 4000,
    }

    await salvarValuation(CONTEXTO, valuation)

    const linhas = readLocalSheet('Valuation')
    expect(linhas[1]?.[0]).toBe('PETR4')
    expect(linhas[1]?.[12]).toBe(5) // LPA em reais
    expect(linhas[1]?.[13]).toBe(40) // VPA em reais
  })
})
