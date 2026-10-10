import { describe, expect, it } from 'vitest'
import {
  encontrarCotacao,
  extrairRegistros,
  lerCotacaoCache,
  type TesouroRegistro,
} from '@/services/tesouro'

/** Testes do parser/serviço de cotação do Tesouro Direto (RF19). */

const payloadCkan = {
  success: true,
  result: {
    records: [
      {
        'Tipo Titulo': 'Tesouro IPCA+ 2029',
        'Data Vencimento': '15/05/2029',
        'Data Base': '05/10/2026',
        'PU Venda Manha': '3.456,78',
      },
      {
        'Tipo Titulo': 'Tesouro IPCA+ 2029',
        'Data Vencimento': '15/05/2029',
        'Data Base': '06/10/2026',
        'PU Venda Manha': '3.500,00',
      },
      {
        'Tipo Titulo': 'Tesouro Selic 2027',
        'Data Vencimento': '01/03/2027',
        'Data Base': '06/10/2026',
        'PU Venda Manha': 15000.5,
      },
    ],
  },
}

describe('extrairRegistros', () => {
  it('extrai registros da resposta CKAN normalizando datas e preços', () => {
    const registros = extrairRegistros(payloadCkan)
    expect(registros).toHaveLength(3)
    expect(registros[0]).toMatchObject({
      tipoTitulo: 'Tesouro IPCA+ 2029',
      dataVencimento: '2029-05-15',
      dataBase: '2026-10-05',
      precoCentavos: 345678,
    })
  })

  it('aceita preço numérico', () => {
    const registros = extrairRegistros(payloadCkan)
    expect(registros[2].precoCentavos).toBe(1500050)
  })

  it('retorna [] para payloads inesperados', () => {
    expect(extrairRegistros(null)).toEqual([])
    expect(extrairRegistros({ result: {} })).toEqual([])
    expect(extrairRegistros({ result: { records: 'nope' } })).toEqual([])
  })
})

describe('encontrarCotacao', () => {
  const registros = extrairRegistros(payloadCkan)

  it('casa por ano e palavra-chave e escolhe a data-base mais recente', () => {
    const cotacao = encontrarCotacao(registros, 'TD-IPCA-2029')
    expect(cotacao).toMatchObject({ preco: 350000, atualizadoEm: '2026-10-06', fonte: 'api' })
  })

  it('casa um ticker com nome descritivo', () => {
    const cotacao = encontrarCotacao(registros, 'Tesouro Selic 2027')
    expect(cotacao?.preco).toBe(1500050)
  })

  it('retorna null quando não há correspondência', () => {
    expect(encontrarCotacao(registros, 'TD-PREFIXADO-2035')).toBeNull()
  })

  it('ignora registros sem preço', () => {
    const semPreco: TesouroRegistro[] = [
      { tipoTitulo: 'Tesouro IPCA+ 2029', dataVencimento: '2029-05-15', dataBase: '2026-10-06', precoCentavos: null },
    ]
    expect(encontrarCotacao(semPreco, 'TD-IPCA-2029')).toBeNull()
  })
})

describe('lerCotacaoCache', () => {
  it('retorna null quando não há cache (ambiente sem LocalStorage)', () => {
    expect(lerCotacaoCache('TD-IPCA-2029')).toBeNull()
  })
})
