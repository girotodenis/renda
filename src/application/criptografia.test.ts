import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ativarCriptografia,
  bloquearBanco,
  desativarCriptografia,
  ErroCriptografiaIndisponivel,
  estadoDoBanco,
  motivoCriptografiaIndisponivel,
  MSG_BACKEND_SHEETS,
  MSG_FILA_PENDENTE,
  MSG_OFFLINE,
  MSG_WEB_CRYPTO_INDISPONIVEL,
} from '@/application/criptografia'
import { SenhaVaziaError } from '@/domain/criptografia'
import type { RepositoryContext } from '@/domain/repositories/ports'

/**
 * Testes das pré-condições da criptografia (§6.2–6.4, §6.7).
 *
 * Todo o ambiente é substituído por mocks: nenhuma rede, nenhum IndexedDB e
 * nenhuma derivação PBKDF2 real (o `criarSessao` é falso). O que se valida aqui
 * é **a ordem das checagens e a mensagem exata** que a UI mostra.
 */

const mocks = vi.hoisted(() => ({
  alterarCriptografia: vi.fn(),
  estadoCriptografia: vi.fn(),
  criptografiaDisponivel: vi.fn(),
  isCriptografiaSuportada: vi.fn(),
  isModoLocal: vi.fn(),
  isJsonBackend: vi.fn(),
  isOnline: vi.fn(),
  contarPendencias: vi.fn(),
  sincronizarPendentes: vi.fn(),
  invalidateSpreadsheetCache: vi.fn(),
  criarSessao: vi.fn(),
  obterChave: vi.fn(),
  esquecerChave: vi.fn(),
  guardarVerificador: vi.fn(),
  esquecerVerificador: vi.fn(),
}))

vi.mock('@/infrastructure/sheets/gatewayRouter', () => ({
  alterarCriptografia: mocks.alterarCriptografia,
  estadoCriptografia: mocks.estadoCriptografia,
  criptografiaDisponivel: mocks.criptografiaDisponivel,
}))

vi.mock('@/infrastructure/cripto/webCrypto', () => ({
  isCriptografiaSuportada: mocks.isCriptografiaSuportada,
}))

vi.mock('@/infrastructure/cripto/envelope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/infrastructure/cripto/envelope')>()
  return { ...real, criarSessao: mocks.criarSessao }
})

vi.mock('@/infrastructure/cripto/chaveSessao', () => ({
  obterChave: mocks.obterChave,
  esquecerChave: mocks.esquecerChave,
  guardarChave: vi.fn(),
  temChave: vi.fn(),
}))

vi.mock('@/infrastructure/cripto/verificadorLocal', () => ({
  guardarVerificador: mocks.guardarVerificador,
  esquecerVerificador: mocks.esquecerVerificador,
}))

vi.mock('@/infrastructure/modoArmazenamento', () => ({
  isModoLocal: mocks.isModoLocal,
}))

vi.mock('@/infrastructure/googleConfig', () => ({
  isJsonBackend: mocks.isJsonBackend,
}))

vi.mock('@/application/online', () => ({
  isOnline: mocks.isOnline,
}))

vi.mock('@/application/sync', () => ({
  contarPendencias: mocks.contarPendencias,
  sincronizarPendentes: mocks.sincronizarPendentes,
}))

vi.mock('@/infrastructure/cache', () => ({
  invalidateSpreadsheetCache: mocks.invalidateSpreadsheetCache,
}))

const context: RepositoryContext = { accessToken: 'token', spreadsheetId: 'banco-1' }
const sessaoFalsa = { chave: {} as CryptoKey, salt: new Uint8Array(16), iteracoes: 600_000 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isCriptografiaSuportada.mockReturnValue(true)
  mocks.isModoLocal.mockReturnValue(false)
  mocks.isJsonBackend.mockReturnValue(true)
  mocks.isOnline.mockReturnValue(true)
  mocks.contarPendencias.mockReturnValue(0)
  mocks.criptografiaDisponivel.mockReturnValue(true)
  mocks.criarSessao.mockResolvedValue(sessaoFalsa)
  mocks.alterarCriptografia.mockResolvedValue(undefined)
})

describe('motivoCriptografiaIndisponivel', () => {
  it('não bloqueia quando há Web Crypto e o backend é o cofre JSON', () => {
    expect(motivoCriptografiaIndisponivel()).toBeNull()
  })

  it('explica o contexto inseguro quando falta Web Crypto', () => {
    mocks.isCriptografiaSuportada.mockReturnValue(false)
    expect(motivoCriptografiaIndisponivel()).toBe(MSG_WEB_CRYPTO_INDISPONIVEL)
  })

  it('explica o backend sheets (células precisam ficar legíveis)', () => {
    mocks.isJsonBackend.mockReturnValue(false)
    expect(motivoCriptografiaIndisponivel()).toBe(MSG_BACKEND_SHEETS)
  })

  it('não bloqueia o modo local, mesmo com backend sheets no build', () => {
    mocks.isModoLocal.mockReturnValue(true)
    mocks.isJsonBackend.mockReturnValue(false)

    expect(motivoCriptografiaIndisponivel()).toBeNull()
  })
})

describe('estadoDoBanco', () => {
  it('devolve o estado do gateway junto da disponibilidade', async () => {
    mocks.estadoCriptografia.mockResolvedValue({ estado: 'total', bloqueado: true })

    await expect(estadoDoBanco(context)).resolves.toEqual({
      estado: 'total',
      bloqueado: true,
      disponivel: true,
    })
    expect(mocks.estadoCriptografia).toHaveBeenCalledWith('token', 'banco-1')
  })
})

describe('ativarCriptografia', () => {
  it('recusa sem Web Crypto antes de qualquer outra checagem', async () => {
    mocks.isCriptografiaSuportada.mockReturnValue(false)

    await expect(ativarCriptografia(context, 'segredo')).rejects.toThrow(
      new ErroCriptografiaIndisponivel(MSG_WEB_CRYPTO_INDISPONIVEL),
    )
    expect(mocks.criarSessao).not.toHaveBeenCalled()
  })

  it('recusa no backend sheets com a mensagem da §6.7', async () => {
    mocks.isJsonBackend.mockReturnValue(false)

    await expect(ativarCriptografia(context, 'segredo')).rejects.toThrow(MSG_BACKEND_SHEETS)
    expect(mocks.criarSessao).not.toHaveBeenCalled()
  })

  it('no modo local ativa sem internet e sem exigir a fila vazia', async () => {
    mocks.isModoLocal.mockReturnValue(true)
    mocks.isOnline.mockReturnValue(false)
    mocks.contarPendencias.mockReturnValue(3)

    await ativarCriptografia(context, 'segredo')

    expect(mocks.criarSessao).toHaveBeenCalledWith('segredo')
    expect(mocks.alterarCriptografia).toHaveBeenCalledWith('token', 'banco-1', sessaoFalsa)
    expect(mocks.guardarVerificador).toHaveBeenCalledWith('banco-1', sessaoFalsa)
  })

  it('recusa senha em branco com a mensagem exata', async () => {
    await expect(ativarCriptografia(context, '   ')).rejects.toBeInstanceOf(SenhaVaziaError)
    expect(mocks.criarSessao).not.toHaveBeenCalled()
  })

  it('exige conexão com a internet', async () => {
    mocks.isOnline.mockReturnValue(false)

    await expect(ativarCriptografia(context, 'segredo')).rejects.toThrow(
      new ErroCriptografiaIndisponivel(MSG_OFFLINE),
    )
    expect(mocks.criarSessao).not.toHaveBeenCalled()
  })

  it('exige a fila offline vazia', async () => {
    mocks.contarPendencias.mockReturnValue(2)

    await expect(ativarCriptografia(context, 'segredo')).rejects.toThrow(
      new ErroCriptografiaIndisponivel(MSG_FILA_PENDENTE),
    )
    expect(mocks.criarSessao).not.toHaveBeenCalled()
    expect(mocks.alterarCriptografia).not.toHaveBeenCalled()
  })

  it('cifra o banco e grava o verificador de desbloqueio offline', async () => {
    await ativarCriptografia(context, 'segredo')

    expect(mocks.criarSessao).toHaveBeenCalledWith('segredo')
    expect(mocks.alterarCriptografia).toHaveBeenCalledWith('token', 'banco-1', sessaoFalsa)
    expect(mocks.guardarVerificador).toHaveBeenCalledWith('banco-1', sessaoFalsa)
  })

  it('propaga a falha do gateway sem gravar verificador', async () => {
    mocks.alterarCriptografia.mockRejectedValue(new Error('falha de rede'))

    await expect(ativarCriptografia(context, 'segredo')).rejects.toThrow('falha de rede')
    expect(mocks.guardarVerificador).not.toHaveBeenCalled()
  })
})

describe('desativarCriptografia', () => {
  it('exige o banco desbloqueado (chave na sessão)', async () => {
    mocks.obterChave.mockReturnValue(null)

    await expect(desativarCriptografia(context)).rejects.toMatchObject({
      name: 'ChaveNecessariaError',
    })
    expect(mocks.alterarCriptografia).not.toHaveBeenCalled()
  })

  it('exige internet e fila vazia', async () => {
    mocks.obterChave.mockReturnValue(sessaoFalsa)
    mocks.isOnline.mockReturnValue(false)
    await expect(desativarCriptografia(context)).rejects.toThrow(MSG_OFFLINE)

    mocks.isOnline.mockReturnValue(true)
    mocks.contarPendencias.mockReturnValue(1)
    await expect(desativarCriptografia(context)).rejects.toThrow(MSG_FILA_PENDENTE)
    expect(mocks.alterarCriptografia).not.toHaveBeenCalled()
  })

  it('no modo local desativa offline e sem fila pendente', async () => {
    mocks.obterChave.mockReturnValue(sessaoFalsa)
    mocks.isModoLocal.mockReturnValue(true)
    mocks.isOnline.mockReturnValue(false)
    mocks.contarPendencias.mockReturnValue(2)

    await desativarCriptografia(context)

    expect(mocks.alterarCriptografia).toHaveBeenCalledWith('token', 'banco-1', null)
    expect(mocks.esquecerChave).toHaveBeenCalledWith('banco-1')
  })

  it('regrava em claro e esquece chave e verificador', async () => {
    mocks.obterChave.mockReturnValue(sessaoFalsa)

    await desativarCriptografia(context)

    expect(mocks.alterarCriptografia).toHaveBeenCalledWith('token', 'banco-1', null)
    expect(mocks.esquecerChave).toHaveBeenCalledWith('banco-1')
    expect(mocks.esquecerVerificador).toHaveBeenCalledWith('banco-1')
  })
})

describe('bloquearBanco', () => {
  it('sincroniza a fila, limpa o cache e esquece a chave', async () => {
    mocks.contarPendencias.mockReturnValueOnce(1).mockReturnValue(0)
    mocks.sincronizarPendentes.mockResolvedValue({ aplicadas: 1, pendentes: 0 })

    await expect(
      bloquearBanco(context, { obterToken: async () => 'token-novo' }),
    ).resolves.toEqual({ pendentes: 0 })

    expect(mocks.sincronizarPendentes).toHaveBeenCalledWith(
      { accessToken: 'token-novo', spreadsheetId: 'banco-1' },
      { obterToken: expect.any(Function) },
    )
    expect(mocks.invalidateSpreadsheetCache).toHaveBeenCalledWith('banco-1')
    expect(mocks.esquecerChave).toHaveBeenCalledWith('banco-1')
  })

  it('mantém as pendências quando o flush falha (best effort)', async () => {
    mocks.contarPendencias.mockReturnValue(3)
    mocks.sincronizarPendentes.mockRejectedValue(new Error('sem rede'))

    await expect(bloquearBanco(context)).resolves.toEqual({ pendentes: 3 })
    expect(mocks.invalidateSpreadsheetCache).toHaveBeenCalledWith('banco-1')
    expect(mocks.esquecerChave).toHaveBeenCalledWith('banco-1')
  })

  it('não tenta sincronizar offline', async () => {
    mocks.contarPendencias.mockReturnValue(2)
    mocks.isOnline.mockReturnValue(false)

    await expect(bloquearBanco(context)).resolves.toEqual({ pendentes: 2 })
    expect(mocks.sincronizarPendentes).not.toHaveBeenCalled()
  })
})
