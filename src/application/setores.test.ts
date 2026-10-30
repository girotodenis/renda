import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoriaAtivo } from '@/domain/entities'
import type { Ativo } from '@/domain/entities'
import {
  carregarSetores,
  limparControleDeSessaoSetores,
  mapaDeSetores,
  tickersComSetor,
} from '@/application/setores'

/**
 * Carga/persistência do setor de atuação (aba `Ativos`): a aba é a fonte para o
 * gráfico "Por setor"; as integrações só são consultadas para quem ainda não
 * tem setor, e o resultado é gravado de volta.
 */

const mocks = vi.hoisted(() => ({
  ativosReadCache: vi.fn(),
  ativosList: vi.fn(),
  ativosReplaceAll: vi.fn(),
  atualizarSetores: vi.fn(),
  ensureRequiredSheets: vi.fn(),
}))

vi.mock('@/infrastructure/repositories', () => ({
  ativosRepo: {
    readCache: mocks.ativosReadCache,
    list: mocks.ativosList,
    replaceAll: mocks.ativosReplaceAll,
  },
}))

vi.mock('@/infrastructure/cotacoes/registro', () => ({
  provedorSetores: {
    atualizar: mocks.atualizarSetores,
    lerCache: () => new Map<string, string>(),
  },
}))

vi.mock('@/infrastructure/sheets/gatewayRouter', () => ({
  ensureRequiredSheets: mocks.ensureRequiredSheets,
}))

const context = { accessToken: 'token', spreadsheetId: 'planilha' }

const posicoes = [
  { ticker: 'PETR4', categoria: CategoriaAtivo.Acao },
  { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii },
  { ticker: 'Tesouro Selic 2029', categoria: CategoriaAtivo.TesouroDireto },
]

beforeEach(() => {
  vi.clearAllMocks()
  limparControleDeSessaoSetores()
  mocks.ativosReadCache.mockReturnValue([])
  mocks.ativosList.mockResolvedValue([])
  mocks.ativosReplaceAll.mockResolvedValue(undefined)
  mocks.ensureRequiredSheets.mockResolvedValue(0)
  mocks.atualizarSetores.mockResolvedValue({
    setores: new Map(),
    semSetor: [],
    semToken: false,
    consultouRede: false,
  })
})

describe('tickersComSetor', () => {
  it('mantém apenas categorias de B3, sem duplicar e em maiúsculas', () => {
    expect(
      tickersComSetor([
        { ticker: 'petr4', categoria: CategoriaAtivo.Acao },
        { ticker: 'PETR4', categoria: CategoriaAtivo.Acao },
        { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii },
        { ticker: 'Tesouro Selic 2029', categoria: CategoriaAtivo.TesouroDireto },
        { ticker: 'CDB Banco X', categoria: CategoriaAtivo.RendaFixa },
        { ticker: '   ', categoria: CategoriaAtivo.Acao },
      ]),
    ).toEqual(['PETR4', 'MXRF11'])
  })
})

describe('mapaDeSetores', () => {
  it('ignora setores vazios e normaliza o ticker', () => {
    const ativos: Ativo[] = [
      { ticker: 'petr4', categoria: CategoriaAtivo.Acao, setor: ' Energia ' },
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, setor: '' },
    ]
    const mapa = mapaDeSetores(ativos)
    expect(mapa.get('PETR4')).toBe('Energia')
    expect(mapa.has('VALE3')).toBe(false)
  })
})

describe('carregarSetores', () => {
  it('usa o que já está na aba `Ativos` sem consultar as integrações', async () => {
    mocks.ativosList.mockResolvedValue([
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, setor: 'Energia' },
    ])

    const setores = await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })

    expect(setores.get('PETR4')).toBe('Energia')
    expect(mocks.atualizarSetores).toHaveBeenCalledTimes(1)
    // Só o FII ficou pendente (Tesouro não tem setor).
    expect(mocks.atualizarSetores.mock.calls[0]![0]).toEqual(['MXRF11'])
    expect(mocks.ativosReplaceAll).not.toHaveBeenCalled()
  })

  it('grava o setor obtido nas integrações na aba `Ativos`', async () => {
    mocks.atualizarSetores.mockResolvedValue({
      setores: new Map([
        ['PETR4', 'Energia'],
        ['MXRF11', 'Logística'],
      ]),
      semSetor: [],
      semToken: false,
      consultouRede: true,
    })

    const setores = await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })

    expect(setores.get('PETR4')).toBe('Energia')
    expect(setores.get('MXRF11')).toBe('Logística')
    expect(mocks.ativosReplaceAll).toHaveBeenCalledTimes(1)

    const gravados = mocks.ativosReplaceAll.mock.calls[0]![1] as Ativo[]
    expect(gravados).toEqual([
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, setor: 'Energia' },
      { ticker: 'MXRF11', categoria: CategoriaAtivo.Fii, setor: 'Logística' },
    ])
  })

  it('preserva as linhas existentes ao mesclar', async () => {
    mocks.ativosList.mockResolvedValue([
      { ticker: 'VALE3', categoria: CategoriaAtivo.Acao, setor: 'Materiais Básicos' },
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, setor: '' },
    ])
    mocks.atualizarSetores.mockResolvedValue({
      setores: new Map([['PETR4', 'Energia']]),
      semSetor: ['MXRF11'],
      semToken: false,
      consultouRede: true,
    })

    const setores = await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })

    expect(setores.get('VALE3')).toBe('Materiais Básicos')
    expect(setores.get('PETR4')).toBe('Energia')
    const gravados = mocks.ativosReplaceAll.mock.calls[0]![1] as Ativo[]
    expect(gravados.map((ativo) => ativo.ticker)).toEqual(['VALE3', 'PETR4'])
    expect(gravados[1]?.setor).toBe('Energia')
  })

  it('em modo offline usa apenas a aba, sem rede', async () => {
    mocks.ativosReadCache.mockReturnValue([
      { ticker: 'PETR4', categoria: CategoriaAtivo.Acao, setor: 'Energia' },
    ])

    const setores = await carregarSetores(context, posicoes, {
      tokens: { brapi: 'token' },
      offline: true,
    })

    expect(setores.get('PETR4')).toBe('Energia')
    expect(mocks.ativosList).not.toHaveBeenCalled()
    expect(mocks.atualizarSetores).not.toHaveBeenCalled()
  })

  it('garante a aba `Ativos` em planilhas antigas (uma vez por sessão)', async () => {
    mocks.atualizarSetores.mockResolvedValue({
      setores: new Map([['PETR4', 'Energia']]),
      semSetor: ['MXRF11'],
      semToken: false,
      consultouRede: true,
    })

    await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })
    await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })

    expect(mocks.ensureRequiredSheets).toHaveBeenCalledTimes(1)
    expect(mocks.ensureRequiredSheets).toHaveBeenCalledWith('token', 'planilha')
    expect(mocks.ativosReplaceAll).toHaveBeenCalledTimes(1)
  })

  it('não repete a consulta na mesma sessão para o mesmo ticker', async () => {
    mocks.atualizarSetores.mockResolvedValue({
      setores: new Map(),
      semSetor: ['PETR4', 'MXRF11'],
      semToken: false,
      consultouRede: true,
    })

    await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })
    await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })

    expect(mocks.atualizarSetores).toHaveBeenCalledTimes(1)
  })

  it('falha ao gravar não impede o uso do setor na carga atual', async () => {
    mocks.atualizarSetores.mockResolvedValue({
      setores: new Map([['PETR4', 'Energia']]),
      semSetor: ['MXRF11'],
      semToken: false,
      consultouRede: true,
    })
    mocks.ativosReplaceAll.mockRejectedValue(new Error('quota'))

    const setores = await carregarSetores(context, posicoes, { tokens: { brapi: 'token' } })

    expect(setores.get('PETR4')).toBe('Energia')
  })
})
