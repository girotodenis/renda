import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recalcularConsolidadoNoCache } from '@/application/consolidado'
import { CategoriaAtivo, OperacaoTipo } from '@/domain/entities'
import type { Consolidado, Operacao } from '@/domain/entities'
import type { RepositoryContext } from '@/domain/repositories/ports'
import { readSheetCache, writeSheetCache } from '@/infrastructure/cache'
import { _resetForTests } from '@/infrastructure/kvStore'

/**
 * Testes do recálculo local do `Consolidado`.
 *
 * Com as escritas local-first, a aba derivada deixa de ser escrita na hora ao
 * salvar: ela é recalculada no app a partir do cache das operações (para a UI
 * ficar consistente) e só vai à origem no flush da sincronização.
 */

const context: RepositoryContext = { accessToken: 'token', spreadsheetId: 'planilha' }

function compra(partial: Partial<Operacao> = {}): Operacao {
  return {
    id: 'op-1',
    data: '2026-10-10',
    tipo: OperacaoTipo.Compra,
    categoria: CategoriaAtivo.Acao,
    ticker: 'PETR4',
    quantidade: 10,
    precoUnitario: 2500,
    taxas: 0,
    indexador: null,
    percentualIndexador: null,
    vencimento: null,
    valorBrutoAtual: null,
    ...partial,
  }
}

beforeEach(() => {
  _resetForTests()
})

describe('recalcularConsolidadoNoCache', () => {
  it('recalcula a partir do cache das operações e grava o cache da aba derivada', () => {
    writeSheetCache<Operacao>(context.spreadsheetId, 'Operacoes', [compra()])

    const consolidado = recalcularConsolidadoNoCache(context)

    expect(consolidado).toHaveLength(1)
    expect(consolidado[0]).toMatchObject({
      ticker: 'PETR4',
      quantidadeAtual: 10,
      precoMedio: 2500,
      totalInvestido: 25000,
    })
    expect(readSheetCache<Consolidado>(context.spreadsheetId, 'Consolidado')?.rows).toEqual(
      consolidado,
    )
  })

  it('sem cache de operações não recalcula nem grava a aba derivada', () => {
    const consolidado = recalcularConsolidadoNoCache(context)

    expect(consolidado).toEqual([])
    expect(readSheetCache(context.spreadsheetId, 'Consolidado')).toBeNull()
  })

  it('não faz nenhuma chamada de rede', () => {
    const fetchSpy = vi.fn(() => {
      throw new TypeError('o recálculo local não pode usar a rede')
    })
    vi.stubGlobal('fetch', fetchSpy)
    writeSheetCache<Operacao>(context.spreadsheetId, 'Operacoes', [compra()])

    recalcularConsolidadoNoCache(context)

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
