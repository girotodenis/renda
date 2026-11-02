import { beforeEach, describe, expect, it } from 'vitest'
import * as cripto from '@/infrastructure/cripto/envelope'
import { temChave } from '@/infrastructure/cripto/chaveSessao'
import * as cofre from '@/infrastructure/cripto/localCofre'
import { temVerificador } from '@/infrastructure/cripto/verificadorLocal'
import { _resetForTests, kvKeys, kvSet } from '@/infrastructure/kvStore'

/**
 * Testes do cofre do modo local (Fase 6).
 *
 * O cofre é o verificador sob o id sintético `local`, então o que se valida é o
 * contrato dele: presença, abertura com a senha certa, recusa da senha errada e
 * remoção sem tocar nas abas.
 */

const SENHA = 'senha de teste'

async function sessaoDeTeste() {
  return cripto.criarSessao(SENHA, { iteracoes: 1000 })
}

beforeEach(() => {
  _resetForTests()
})

describe('criarCofreLocal / abrirCofreLocal', () => {
  it('cria o cofre e abre com a senha certa', async () => {
    const original = await sessaoDeTeste()
    expect(cofre.temCofreLocal()).toBe(false)

    await cofre.criarCofreLocal(original)

    expect(cofre.temCofreLocal()).toBe(true)
    expect(temVerificador(cofre.ID_COFRE_LOCAL)).toBe(true)

    const aberta = await cofre.abrirCofreLocal(SENHA)
    expect(aberta).not.toBeNull()
    if (!aberta) throw new Error('O cofre deveria abrir com a senha correta')
    expect(aberta.iteracoes).toBe(original.iteracoes)
    expect(aberta.salt).toEqual(original.salt)
  })

  it('não guarda a chave na sessão (isso é decisão de quem chama)', async () => {
    await cofre.criarCofreLocal(await sessaoDeTeste())

    expect(temChave(cofre.ID_COFRE_LOCAL)).toBe(false)
  })

  it('devolve null com a senha errada', async () => {
    await cofre.criarCofreLocal(await sessaoDeTeste())

    await expect(cofre.abrirCofreLocal('senha errada')).resolves.toBeNull()
  })

  it('devolve null quando não há cofre', async () => {
    await expect(cofre.abrirCofreLocal(SENHA)).resolves.toBeNull()
  })

  it('substitui o cofre anterior ao criar de novo', async () => {
    await cofre.criarCofreLocal(await sessaoDeTeste())
    const novaSessao = await cripto.criarSessao('outra senha', { iteracoes: 1000 })

    await cofre.criarCofreLocal(novaSessao)

    await expect(cofre.abrirCofreLocal('outra senha')).resolves.not.toBeNull()
    await expect(cofre.abrirCofreLocal(SENHA)).resolves.toBeNull()
  })
})

describe('removerCofreLocal', () => {
  it('apaga o cofre e mantém as abas intactas', async () => {
    await cofre.criarCofreLocal(await sessaoDeTeste())
    kvSet('sheets', 'local-sheet::Operacoes', [['ID']])

    cofre.removerCofreLocal()

    expect(cofre.temCofreLocal()).toBe(false)
    expect(kvKeys('sheets')).toEqual(['local-sheet::Operacoes'])
    await expect(cofre.abrirCofreLocal(SENHA)).resolves.toBeNull()
  })

  it('é idempotente sem cofre', () => {
    expect(() => cofre.removerCofreLocal()).not.toThrow()
    expect(cofre.temCofreLocal()).toBe(false)
  })
})
