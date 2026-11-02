import { beforeEach, describe, expect, it } from 'vitest'
import * as cripto from '@/infrastructure/cripto/envelope'
import * as verificador from '@/infrastructure/cripto/verificadorLocal'
import { _resetForTests, kvGet, kvKeys, kvSet } from '@/infrastructure/kvStore'

/**
 * Testes do verificador de desbloqueio offline (decisão 10).
 *
 * O IndexedDB é substituído pelo espelho em memória do `kvStore` (o ambiente de
 * testes é `node`). As iterações ficam em 1.000 para não pesar a suíte; o piso
 * aceito na leitura é justamente 1.000.
 */

const ID = 'arquivo-1'
const OUTRO_ID = 'arquivo-2'
const SENHA = 'senha de teste'
const CHAVE_REGISTRO = `cripto-verificador::${ID}`

function sessaoDeTeste(senha = SENHA) {
  return cripto.criarSessao(senha, { iteracoes: 1000 })
}

beforeEach(() => {
  _resetForTests()
})

describe('guardarVerificador / abrirVerificador', () => {
  it('abre com a senha certa e devolve a mesma chave derivada', async () => {
    const original = await sessaoDeTeste()

    await verificador.guardarVerificador(ID, original)
    const aberta = await verificador.abrirVerificador(ID, SENHA)

    expect(aberta).not.toBeNull()
    if (!aberta) throw new Error('O verificador deveria abrir com a senha correta')
    expect(aberta.iteracoes).toBe(original.iteracoes)
    expect(aberta.salt).toEqual(original.salt)

    // A sessão devolvida precisa decifrar um arquivo criado com a sessão original.
    const arquivo = await cripto.cifrarArquivo(new TextEncoder().encode('carteira'), original)
    const claro = await cripto.decifrarArquivo(arquivo, aberta.chave)
    expect(new TextDecoder().decode(claro)).toBe('carteira')
  })

  it('devolve null com a senha errada, sem lançar', async () => {
    await verificador.guardarVerificador(ID, await sessaoDeTeste())

    await expect(verificador.abrirVerificador(ID, 'senha errada')).resolves.toBeNull()
  })

  it('devolve null para senha vazia', async () => {
    await verificador.guardarVerificador(ID, await sessaoDeTeste())

    await expect(verificador.abrirVerificador(ID, '   ')).resolves.toBeNull()
  })

  it('devolve null quando o banco não tem verificador', async () => {
    await expect(verificador.abrirVerificador('sem-verificador', SENHA)).resolves.toBeNull()
  })

  it('não abre um verificador copiado para outro banco (AAD é o id)', async () => {
    await verificador.guardarVerificador(ID, await sessaoDeTeste())
    // Outro dispositivo/cópia manual do registro sob outro id.
    kvSet('sheets', `cripto-verificador::${OUTRO_ID}`, kvGet('sheets', CHAVE_REGISTRO))

    await expect(verificador.abrirVerificador(OUTRO_ID, SENHA)).resolves.toBeNull()
    // O original continua válido.
    await expect(verificador.abrirVerificador(ID, SENHA)).resolves.not.toBeNull()
  })

  it('grava apenas parâmetros do KDF e o bloco cifrado (nunca a senha)', async () => {
    await verificador.guardarVerificador(ID, await sessaoDeTeste())

    const registro = kvGet<verificador.VerificadorLocal>('sheets', CHAVE_REGISTRO)
    expect(registro).toMatchObject({ versao: 1, kdf: { iteracoes: 1000 } })
    expect(typeof registro?.kdf.salt).toBe('string')
    expect(typeof registro?.iv).toBe('string')
    expect(typeof registro?.verificador).toBe('string')

    const serializado = JSON.stringify(registro)
    expect(serializado).not.toContain(SENHA)
    expect(serializado).not.toContain(verificador.TEXTO_VERIFICADOR)
  })

  it('rejeita registro corrompido ou com KDF fora da faixa', async () => {
    const sessao = await sessaoDeTeste()
    await verificador.guardarVerificador(ID, sessao)
    const original = kvGet<verificador.VerificadorLocal>('sheets', CHAVE_REGISTRO)
    if (!original) throw new Error('O verificador deveria ter sido gravado')

    kvSet('sheets', CHAVE_REGISTRO, { ...original, versao: 99 })
    await expect(verificador.abrirVerificador(ID, SENHA)).resolves.toBeNull()
    expect(verificador.temVerificador(ID)).toBe(false)

    kvSet('sheets', CHAVE_REGISTRO, { ...original, kdf: { ...original.kdf, iteracoes: 10 } })
    await expect(verificador.abrirVerificador(ID, SENHA)).resolves.toBeNull()

    kvSet('sheets', CHAVE_REGISTRO, { ...original, verificador: 'não-é-base64' })
    await expect(verificador.abrirVerificador(ID, SENHA)).resolves.toBeNull()
  })
})

describe('temVerificador / esquecer', () => {
  it('acompanha a presença do registro por banco', async () => {
    expect(verificador.temVerificador(ID)).toBe(false)

    await verificador.guardarVerificador(ID, await sessaoDeTeste())

    expect(verificador.temVerificador(ID)).toBe(true)
    expect(verificador.temVerificador(OUTRO_ID)).toBe(false)

    verificador.esquecerVerificador(ID)

    expect(verificador.temVerificador(ID)).toBe(false)
    await expect(verificador.abrirVerificador(ID, SENHA)).resolves.toBeNull()
  })

  it('esquecerTodosOsVerificadores limpa só os verificadores', async () => {
    const sessao = await sessaoDeTeste()
    await verificador.guardarVerificador(ID, sessao)
    await verificador.guardarVerificador(OUTRO_ID, sessao)
    kvSet('sheets', `${ID}.Operacoes`, { rows: [] })

    verificador.esquecerTodosOsVerificadores()

    expect(verificador.temVerificador(ID)).toBe(false)
    expect(verificador.temVerificador(OUTRO_ID)).toBe(false)
    // O cache de abas não é afetado (é outro tipo de registro).
    expect(kvKeys('sheets')).toEqual([`${ID}.Operacoes`])
  })
})
