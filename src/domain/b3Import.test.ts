import { describe, expect, it } from 'vitest'
import {
  analisarExtratoB3,
  classificarCategoria,
  extrairTicker,
  mapearTipoProvento,
} from '@/domain/b3Import'
import { parseCsv } from '@/domain/csv'
import { CategoriaAtivo, ProventoTipo } from '@/domain/entities'

/** Testes do importador de extratos B3 (RF23, Etapa 8). */

describe('parseCsv', () => {
  it('separa campos com aspas, vírgulas internas e escape de aspas', () => {
    const linhas = parseCsv(
      'a,b,"R$ 3.563,45","AMZO34 - AMAZON.COM, INC"\n"aspas ""duplas""",x,y\n',
    )
    expect(linhas).toEqual([
      ['a', 'b', 'R$ 3.563,45', 'AMZO34 - AMAZON.COM, INC'],
      ['aspas "duplas"', 'x', 'y'],
    ])
  })

  it('ignora BOM e aceita CRLF', () => {
    const linhas = parseCsv('\uFEFFa,b\r\n1,2\r\n')
    expect(linhas).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('extrairTicker', () => {
  it('extrai ticker de "TICKER - NOME"', () => {
    expect(extrairTicker('B1AM34 - BROOKFIELD ASSET MANAGEMENT INC')).toBe('B1AM34')
    expect(extrairTicker('BBAS3 - BCO BRASIL S.A.                                   ')).toBe('BBAS3')
    expect(extrairTicker('BTLG11 - BTG PACTUAL LOGISTICA')).toBe('BTLG11')
  })

  it('retorna null para produtos sem ticker (ex.: Tesouro)', () => {
    expect(extrairTicker('Tesouro Educa+ 2035')).toBeNull()
  })
})

describe('classificarCategoria', () => {
  it('classifica BDR, FII e Ação pelo sufixo', () => {
    expect(classificarCategoria('B1AM34')).toBe(CategoriaAtivo.Bdr)
    expect(classificarCategoria('BTLG11')).toBe(CategoriaAtivo.Fii)
    expect(classificarCategoria('KNCR12')).toBe(CategoriaAtivo.Fii)
    expect(classificarCategoria('BBAS3')).toBe(CategoriaAtivo.Acao)
    expect(classificarCategoria('BBDC4')).toBe(CategoriaAtivo.Acao)
  })
})

describe('mapearTipoProvento', () => {
  it('mapeia os tipos suportados e retorna null para os demais', () => {
    expect(mapearTipoProvento('Dividendo')).toBe(ProventoTipo.Dividendo)
    expect(mapearTipoProvento('Juros Sobre Capital Próprio')).toBe(ProventoTipo.Jcp)
    expect(mapearTipoProvento('Rendimento')).toBe(ProventoTipo.Rendimento)
    expect(mapearTipoProvento('Reembolso')).toBeNull()
  })
})

const csvMovimentacao = [
  'Entrada/Saída,Data,Movimentação,Produto,Instituição,Quantidade,Preço unitário,Valor da Operação',
  'Credito,05/10/2026,Dividendo,B1AM34 - BROOKFIELD ASSET MANAGEMENT INC,SANTANDER,27," R$0,066 "," R$1,77 "',
  'Debito,22/09/2026,Transferência - Liquidação,BBAS3 - BANCO DO BRASIL S/A,XP,155," R$22,99 "," R$3.563,45 "',
  'Credito,22/09/2026,Transferência - Liquidação,BBAS3 - BANCO DO BRASIL S/A,XP,10," R$20,00 "," R$200,00 "',
  'Credito,21/09/2026,Empréstimo,BBAS3 - BCO BRASIL S.A.,XP,155, - ," R$0,07 "',
  'Credito,11/09/2026,Reembolso,BBAS3 - BCO BRASIL S.A.,XP,0, - ," R$17,86 "',
  'Credito,09/09/2026,Transferência,"AMZO34 - AMAZON.COM, INC",SANTANDER,10, - , - ',
  'Credito,01/10/2026,Juros Sobre Capital Próprio,BBDC3 - BANCO BRADESCO S/A,XP,125," R$0,017 "," R$1,78 "',
].join('\n')

describe('analisarExtratoB3 (movimentação)', () => {
  it('classifica proventos, compras/vendas e ignora o restante', () => {
    const resultado = analisarExtratoB3(csvMovimentacao)

    expect(resultado.formato).toBe('movimentacao')
    expect(resultado.proventos).toHaveLength(2)
    expect(resultado.operacoes).toHaveLength(2)
    expect(resultado.ignorados).toHaveLength(3)

    const dividendo = resultado.proventos.find((p) => p.ticker === 'B1AM34')
    expect(dividendo).toMatchObject({
      categoria: CategoriaAtivo.Bdr,
      tipo: ProventoTipo.Dividendo,
      dataPagamento: '2026-10-05',
      valorTotal: 177,
    })

    const jcp = resultado.proventos.find((p) => p.ticker === 'BBDC3')
    expect(jcp).toMatchObject({ categoria: CategoriaAtivo.Acao, tipo: ProventoTipo.Jcp, valorTotal: 178 })

    const venda = resultado.operacoes.find((o) => o.tipo === 'Venda')
    expect(venda).toMatchObject({ ticker: 'BBAS3', quantidade: 155, precoUnitario: 2299 })

    const compra = resultado.operacoes.find((o) => o.tipo === 'Compra')
    expect(compra).toMatchObject({ ticker: 'BBAS3', quantidade: 10, precoUnitario: 2000 })
  })

  it('gera IDs determinísticos (reimportar não muda o ID)', () => {
    const primeiro = analisarExtratoB3(csvMovimentacao)
    const segundo = analisarExtratoB3(csvMovimentacao)
    expect(primeiro.proventos.map((p) => p.id)).toEqual(segundo.proventos.map((p) => p.id))
    expect(primeiro.operacoes.map((o) => o.id)).toEqual(segundo.operacoes.map((o) => o.id))
    expect(primeiro.proventos[0].id).toMatch(/^b3p-/)
  })
})

const csvProventos = [
  'Produto,Pagamento,Tipo de Evento,Instituição,Quantidade,Preço unitário,Valor líquido',
  'B1AM34 - BROOKFIELD ASSET MANAGEMENT INC,05/10/2026,Dividendo,SANTANDER,27," R$0,07 "," R$1,77 "',
  'BBDC3 - BANCO BRADESCO S/A,01/10/2026,Juros Sobre Capital Próprio,XP,125," R$0,02 "," R$1,78 "',
  'BTLG11 - BTG PACTUAL LOGISTICA,25/09/2026,Rendimento,XP,22," R$0,81 "," R$17,82 "',
  'BBAS3 - BCO BRASIL S.A.,11/09/2026,Reembolso,XP,-, - ," R$17,86 "',
  ',,,,,,',
  ',,,,,,Total',
  ',,,,,," R$4.490,58 "',
].join('\n')

describe('analisarExtratoB3 (proventos)', () => {
  it('importa proventos e ignora Reembolso e o rodapé de total', () => {
    const resultado = analisarExtratoB3(csvProventos)

    expect(resultado.formato).toBe('proventos')
    expect(resultado.proventos).toHaveLength(3)
    expect(resultado.ignorados).toHaveLength(1)
    expect(resultado.ignorados[0].motivo).toContain('Reembolso')

    const rendimento = resultado.proventos.find((p) => p.ticker === 'BTLG11')
    expect(rendimento).toMatchObject({
      categoria: CategoriaAtivo.Fii,
      tipo: ProventoTipo.Rendimento,
      dataPagamento: '2026-09-25',
      valorTotal: 1782,
    })
  })
})

describe('analisarExtratoB3 (entradas inesperadas)', () => {
  it('retorna vazio para texto sem cabeçalho reconhecível', () => {
    const resultado = analisarExtratoB3('a,b,c\n1,2,3')
    expect(resultado.formato).toBeNull()
    expect(resultado.proventos).toEqual([])
    expect(resultado.operacoes).toEqual([])
    expect(resultado.ignorados).toHaveLength(1)
  })

  it('retorna vazio para texto vazio', () => {
    const resultado = analisarExtratoB3('')
    expect(resultado.formato).toBeNull()
    expect(resultado.totalLinhas).toBe(0)
  })
})
