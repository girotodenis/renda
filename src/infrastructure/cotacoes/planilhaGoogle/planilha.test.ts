import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CABECALHO,
  PLANILHA_STORAGE_KEY,
  _resetPlanilhaForTests,
  garantirPlanilha,
  lerCotacoes,
  limparPlanilhaCotacoes,
  parsePrecoPlanilha,
  reconciliarTickers,
} from '@/infrastructure/cotacoes/planilhaGoogle/planilha'

/** Testes do parse tolerante, da reconciliação e da criação da planilha. */

const mocks = vi.hoisted(() => ({
  lerValores: vi.fn(),
  escreverValores: vi.fn(),
  limparValores: vi.fn(),
  garantirAba: vi.fn(),
  criarPlanilhaCotacoes: vi.fn(),
  descobrirPlanilhaCotacoes: vi.fn(),
}))

vi.mock('@/infrastructure/cotacoes/planilhaGoogle/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/cotacoes/planilhaGoogle/api')>()
  return {
    ...real,
    lerValores: mocks.lerValores,
    escreverValores: mocks.escreverValores,
    limparValores: mocks.limparValores,
    garantirAba: mocks.garantirAba,
    criarPlanilhaCotacoes: mocks.criarPlanilhaCotacoes,
    descobrirPlanilhaCotacoes: mocks.descobrirPlanilhaCotacoes,
  }
})

const drive = vi.hoisted(() => ({
  ensureAppFolder: vi.fn(),
  moveFileToFolder: vi.fn(),
}))

vi.mock('@/infrastructure/drive', () => ({
  ensureAppFolder: drive.ensureAppFolder,
  moveFileToFolder: drive.moveFileToFolder,
}))

const armazenamento = new Map<string, string>()

vi.mock('@/infrastructure/storage', () => ({
  readStorageJson: (chave: string) => {
    const valor = armazenamento.get(chave)
    return valor === undefined ? null : JSON.parse(valor)
  },
  writeStorageJson: (chave: string, valor: unknown) => {
    armazenamento.set(chave, JSON.stringify(valor))
  },
  removeStorageKey: (chave: string) => {
    armazenamento.delete(chave)
  },
}))

const METADADOS = { locale: 'pt_BR', abas: [{ titulo: 'Cotações', sheetId: 0 }] }

beforeEach(() => {
  vi.clearAllMocks()
  armazenamento.clear()
  _resetPlanilhaForTests()
  mocks.garantirAba.mockResolvedValue(METADADOS)
  drive.ensureAppFolder.mockResolvedValue('pasta-app')
  drive.moveFileToFolder.mockResolvedValue(undefined)
})

describe('parsePrecoPlanilha', () => {
  it('aceita número e string com vírgula (reais → centavos)', () => {
    expect(parsePrecoPlanilha(38.5)).toBe(3850)
    expect(parsePrecoPlanilha('38,50')).toBe(3850)
    expect(parsePrecoPlanilha('1.234,56')).toBe(123456)
    expect(parsePrecoPlanilha('R$ 8,15')).toBe(815)
  })

  it('ignora #N/A, vazio, texto, zero e preço abaixo de R$ 0,20', () => {
    expect(parsePrecoPlanilha('#N/A')).toBeNull()
    expect(parsePrecoPlanilha('')).toBeNull()
    expect(parsePrecoPlanilha('   ')).toBeNull()
    expect(parsePrecoPlanilha('sem preço')).toBeNull()
    expect(parsePrecoPlanilha(0)).toBeNull()
    expect(parsePrecoPlanilha('0,00')).toBeNull()
    expect(parsePrecoPlanilha(0.15)).toBeNull()
    expect(parsePrecoPlanilha(null)).toBeNull()
    expect(parsePrecoPlanilha(0.2)).toBe(20)
  })
})

describe('lerCotacoes', () => {
  it('faz um único values.get e ignora células inválidas', async () => {
    mocks.lerValores.mockResolvedValue([
      ['PETR4', 38.5, 38, 1.31],
      ['VALE3', '#N/A', '', ''],
      ['HGLG11', '0,15', '0,15', ''],
      ['ITSA4', 'texto', 10, ''],
      ['B3SA3', '9,90', 9.8, 1],
      [],
    ])

    const cotacoes = await lerCotacoes('token', 'planilha-1', [
      'petr4',
      'VALE3',
      'HGLG11',
      'ITSA4',
      'B3SA3',
      'NAOESTA',
    ])

    expect(mocks.lerValores).toHaveBeenCalledTimes(1)
    expect(mocks.lerValores).toHaveBeenCalledWith('token', 'planilha-1', 'Cotações!A2:D')
    expect(cotacoes.get('PETR4')).toEqual({ preco: 3850, abertura: 3800 })
    expect(cotacoes.get('B3SA3')).toEqual({ preco: 990, abertura: 980 })
    expect(cotacoes.has('VALE3')).toBe(false)
    expect(cotacoes.has('HGLG11')).toBe(false)
    expect(cotacoes.has('ITSA4')).toBe(false)
    expect(cotacoes.has('NAOESTA')).toBe(false)
  })

  it('não devolve tickers fora da lista pedida', async () => {
    mocks.lerValores.mockResolvedValue([['PETR4', 38.5, 38, 1], ['VALE3', 60, 59, 1]])

    const cotacoes = await lerCotacoes('token', 'planilha-1', ['PETR4'])

    expect([...cotacoes.keys()]).toEqual(['PETR4'])
  })
})

describe('reconciliarTickers', () => {
  it('não regrava a planilha quando a lista de tickers não mudou', async () => {
    mocks.lerValores.mockResolvedValue([['PETR4'], ['VALE3']])

    await reconciliarTickers('token', 'planilha-1', ['VALE3', 'PETR4', 'petr4'])

    expect(mocks.escreverValores).not.toHaveBeenCalled()
    expect(mocks.limparValores).not.toHaveBeenCalled()
  })

  it('regrava as fórmulas quando entra um ticker novo', async () => {
    mocks.lerValores.mockResolvedValue([['PETR4']])

    await reconciliarTickers('token', 'planilha-1', ['PETR4', 'VALE3'])

    expect(mocks.limparValores).toHaveBeenCalledWith('token', 'planilha-1', 'Cotações!A2:D')
    expect(mocks.escreverValores).toHaveBeenCalledTimes(1)
    const [, , range, values] = mocks.escreverValores.mock.calls[0]
    expect(range).toBe('Cotações!A2:D3')
    expect(values).toEqual([
      ['PETR4', '=GOOGLEFINANCE("BVMF:"&$A2;"price")', '=GOOGLEFINANCE("BVMF:"&$A2;"priceopen")', '=IF(OR($C2<=0;$B2<=0);"";($B2-$C2)/$C2*100)'],
      ['VALE3', '=GOOGLEFINANCE("BVMF:"&$A3;"price")', '=GOOGLEFINANCE("BVMF:"&$A3;"priceopen")', '=IF(OR($C3<=0;$B3<=0);"";($B3-$C3)/$C3*100)'],
    ])
  })

  it('preserva os tickers já gravados (a cadeia só envia o que falta preço)', async () => {
    mocks.lerValores.mockResolvedValue([['HGLG11'], ['PETR4']])

    await reconciliarTickers('token', 'planilha-1', ['PETR4'])

    expect(mocks.escreverValores).not.toHaveBeenCalled()
    expect(mocks.limparValores).not.toHaveBeenCalled()
  })

  it('usa vírgula como separador em planilhas de locale en_US', async () => {
    mocks.lerValores.mockResolvedValue([])
    mocks.garantirAba.mockResolvedValue({
      locale: 'en_US',
      abas: [{ titulo: 'Cotações', sheetId: 0 }],
    })

    await reconciliarTickers('token', 'planilha-1', ['PETR4'])

    const [, , , values] = mocks.escreverValores.mock.calls[0]
    expect(values[0][1]).toBe('=GOOGLEFINANCE("BVMF:"&$A2,"price")')
  })
})

describe('garantirPlanilha', () => {
  it('cria a planilha, grava o cabeçalho e persiste o id quando não existe', async () => {
    mocks.descobrirPlanilhaCotacoes.mockResolvedValue(null)
    mocks.criarPlanilhaCotacoes.mockResolvedValue({ spreadsheetId: 'nova-planilha' })

    const id = await garantirPlanilha('token')

    expect(id).toBe('nova-planilha')
    expect(mocks.criarPlanilhaCotacoes).toHaveBeenCalledWith('token', { folderId: 'pasta-app' })
    expect(mocks.escreverValores).toHaveBeenCalledWith('token', 'nova-planilha', 'Cotações!A1:D1', [
      CABECALHO,
    ])
    expect(JSON.parse(armazenamento.get(PLANILHA_STORAGE_KEY) ?? 'null')).toBe('nova-planilha')
  })

  it('reaproveita o id salvo sem chamar a criação', async () => {
    armazenamento.set(PLANILHA_STORAGE_KEY, JSON.stringify('salva'))

    const id = await garantirPlanilha('token')

    expect(id).toBe('salva')
    expect(mocks.criarPlanilhaCotacoes).not.toHaveBeenCalled()
    expect(mocks.descobrirPlanilhaCotacoes).not.toHaveBeenCalled()
  })

  it('descobre a planilha pelo nome quando não há id salvo', async () => {
    mocks.descobrirPlanilhaCotacoes.mockResolvedValue('achada')

    const id = await garantirPlanilha('token')

    expect(id).toBe('achada')
    expect(mocks.criarPlanilhaCotacoes).not.toHaveBeenCalled()
    expect(JSON.parse(armazenamento.get(PLANILHA_STORAGE_KEY) ?? 'null')).toBe('achada')
  })

  it('move a planilha já existente para a pasta do app uma vez por sessão', async () => {
    armazenamento.set(PLANILHA_STORAGE_KEY, JSON.stringify('salva'))

    await garantirPlanilha('token')
    await garantirPlanilha('token')

    expect(drive.moveFileToFolder).toHaveBeenCalledTimes(1)
    expect(drive.moveFileToFolder).toHaveBeenCalledWith('token', 'salva', 'pasta-app')
  })

  it('cria na raiz quando a pasta do app não pode ser garantida', async () => {
    drive.ensureAppFolder.mockRejectedValue(new Error('sem rede'))
    mocks.descobrirPlanilhaCotacoes.mockResolvedValue(null)
    mocks.criarPlanilhaCotacoes.mockResolvedValue({ spreadsheetId: 'sem-pasta' })

    const id = await garantirPlanilha('token')

    expect(id).toBe('sem-pasta')
    expect(mocks.criarPlanilhaCotacoes).toHaveBeenCalledWith('token', { folderId: undefined })
    expect(drive.moveFileToFolder).not.toHaveBeenCalled()
  })

  it('recria quando o id salvo aponta para uma planilha apagada (404)', async () => {
    armazenamento.set(PLANILHA_STORAGE_KEY, JSON.stringify('apagada'))
    mocks.garantirAba.mockRejectedValueOnce(
      new (await import('@/infrastructure/cotacoes/planilhaGoogle/api')).PlanilhaCotacoesError(
        404,
        'Planilha de cotações não encontrada.',
      ),
    )
    mocks.descobrirPlanilhaCotacoes.mockResolvedValue(null)
    mocks.criarPlanilhaCotacoes.mockResolvedValue({ spreadsheetId: 'recriada' })

    const id = await garantirPlanilha('token')

    expect(id).toBe('recriada')
    expect(JSON.parse(armazenamento.get(PLANILHA_STORAGE_KEY) ?? 'null')).toBe('recriada')
  })
})

describe('limparPlanilhaCotacoes', () => {
  it('esquece o id salvo (o próximo sync descobre ou cria outra planilha)', () => {
    armazenamento.set(PLANILHA_STORAGE_KEY, JSON.stringify('salva'))

    limparPlanilhaCotacoes()

    expect(armazenamento.has(PLANILHA_STORAGE_KEY)).toBe(false)
  })
})
