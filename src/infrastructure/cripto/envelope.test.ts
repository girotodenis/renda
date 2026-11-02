import { afterEach, describe, expect, it } from 'vitest'
import { KDF_ITERACOES, MAGIC, SALT_BYTES } from '@/domain/criptografia'
import {
  _resetChavesForTests,
  esquecerChave,
  esquecerTodasAsChaves,
  guardarChave,
  obterChave,
  temChave,
} from '@/infrastructure/cripto/chaveSessao'
import {
  ChaveIncorretaError,
  ChaveNecessariaError,
  abrirComSenha,
  cifrarArquivo,
  criarSessao,
  decifrarArquivo,
  estaCifrado,
  lerCabecalho,
} from '@/infrastructure/cripto/envelope'
import type { SessaoCripto } from '@/infrastructure/cripto/envelope'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SENHA = 'senha de teste'
const ITERACOES_TESTE = 1000
const CONTEUDO = encoder.encode(
  JSON.stringify({ version: 1, sheets: { posicoes: [{ ticker: 'PETR4' }] } }),
)

async function sessaoDeTeste(senha = SENHA): Promise<SessaoCripto> {
  return criarSessao(senha, { iteracoes: ITERACOES_TESTE })
}

/** Separa o container em cabeçalho (objeto) e ciphertext, para adulterar um sem o outro. */
function separar(arquivo: Uint8Array): { bruto: Record<string, unknown>; ciphertext: Uint8Array } {
  const inicioJson = MAGIC.length + 1
  const fimJson = arquivo.indexOf(0x0a, inicioJson)
  const texto = decoder.decode(arquivo.subarray(inicioJson, fimJson))
  return {
    bruto: JSON.parse(texto) as Record<string, unknown>,
    ciphertext: arquivo.slice(fimJson + 1),
  }
}

/** Remonta o container com um cabeçalho alterado e o mesmo ciphertext. */
function comCabecalho(
  arquivo: Uint8Array,
  alterar: (bruto: Record<string, unknown>) => void,
): Uint8Array {
  const { bruto, ciphertext } = separar(arquivo)
  alterar(bruto)
  const json = encoder.encode(JSON.stringify(bruto))
  const prefixo = new Uint8Array([...encoder.encode(`${MAGIC}\n`), ...json, 0x0a])
  const saida = new Uint8Array(prefixo.length + ciphertext.length)
  saida.set(prefixo)
  saida.set(ciphertext, prefixo.length)
  return saida
}

function secao(bruto: Record<string, unknown>, chave: 'kdf' | 'cifra'): Record<string, unknown> {
  return bruto[chave] as Record<string, unknown>
}

/** Troca um caractere Base64 por outro válido, mantendo o tamanho. */
function trocarCaractere(valor: string): string {
  return `${valor[0] === 'A' ? 'B' : 'A'}${valor.slice(1)}`
}

afterEach(() => {
  _resetChavesForTests()
})

describe('cifrarArquivo + decifrarArquivo', () => {
  it('faz round-trip do conteúdo', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)

    expect(estaCifrado(cifrado)).toBe(true)
    expect(decoder.decode(cifrado)).not.toContain('PETR4')
    expect(await decifrarArquivo(cifrado, sessao.chave)).toEqual(CONTEUDO)
  })

  it('grava magic, cabeçalho e ciphertext na ordem do plano', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)

    expect(decoder.decode(cifrado.subarray(0, MAGIC.length))).toBe(MAGIC)
    expect(cifrado[MAGIC.length]).toBe(0x0a)

    const cabecalho = lerCabecalho(cifrado)
    expect(cabecalho.versao).toBe(1)
    expect(cabecalho.iteracoes).toBe(ITERACOES_TESTE)
    expect(cabecalho.salt).toEqual(sessao.salt)
  })

  it('rejeita a chave de outra senha', async () => {
    const sessao = await sessaoDeTeste()
    const outra = await sessaoDeTeste('outra senha')
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)

    await expect(decifrarArquivo(cifrado, outra.chave)).rejects.toBeInstanceOf(ChaveIncorretaError)
    await expect(decifrarArquivo(cifrado, outra.chave)).rejects.toThrow(
      'Chave incorreta. Verifique e tente novamente.',
    )
  })

  it('falha quando um bit do ciphertext muda', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)
    const adulterado = cifrado.slice()
    adulterado[adulterado.length - 1] ^= 0x01

    await expect(decifrarArquivo(adulterado, sessao.chave)).rejects.toBeInstanceOf(
      ChaveIncorretaError,
    )
  })

  it('falha quando o salt do cabeçalho muda (AAD)', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)
    const adulterado = comCabecalho(cifrado, (bruto) => {
      const kdf = secao(bruto, 'kdf')
      kdf.s = trocarCaractere(String(kdf.s))
    })

    expect(() => lerCabecalho(adulterado)).not.toThrow()
    await expect(decifrarArquivo(adulterado, sessao.chave)).rejects.toBeInstanceOf(
      ChaveIncorretaError,
    )
  })

  it('falha quando as iterações do cabeçalho mudam (AAD)', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)
    const adulterado = comCabecalho(cifrado, (bruto) => {
      secao(bruto, 'kdf').i = 2000
    })

    expect(() => lerCabecalho(adulterado)).not.toThrow()
    await expect(decifrarArquivo(adulterado, sessao.chave)).rejects.toBeInstanceOf(
      ChaveIncorretaError,
    )
  })

  it('falha quando o IV do cabeçalho muda (AAD e IV)', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)
    const adulterado = comCabecalho(cifrado, (bruto) => {
      const cifra = secao(bruto, 'cifra')
      cifra.iv = trocarCaractere(String(cifra.iv))
    })

    expect(() => lerCabecalho(adulterado)).not.toThrow()
    await expect(decifrarArquivo(adulterado, sessao.chave)).rejects.toBeInstanceOf(
      ChaveIncorretaError,
    )
  })

  it('falha quando o cabeçalho vira lixo', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)
    const inicioJson = MAGIC.length + 1
    const fimJson = cifrado.indexOf(0x0a, inicioJson)
    const adulterado = new Uint8Array([
      ...cifrado.subarray(0, inicioJson),
      ...encoder.encode('{"v":1'),
      ...cifrado.subarray(fimJson),
    ])

    await expect(decifrarArquivo(adulterado, sessao.chave)).rejects.toBeInstanceOf(
      ChaveIncorretaError,
    )
  })

  it('decifrarArquivo recusa arquivo em claro', async () => {
    const sessao = await sessaoDeTeste()

    await expect(decifrarArquivo(CONTEUDO, sessao.chave)).rejects.toBeInstanceOf(
      ChaveIncorretaError,
    )
  })

  it('usa IV e ciphertext diferentes para o mesmo conteúdo', async () => {
    const sessao = await sessaoDeTeste()
    const primeiro = await cifrarArquivo(CONTEUDO, sessao)
    const segundo = await cifrarArquivo(CONTEUDO, sessao)

    expect(lerCabecalho(primeiro).iv).not.toEqual(lerCabecalho(segundo).iv)
    expect(separar(primeiro).ciphertext).not.toEqual(separar(segundo).ciphertext)

    expect(await decifrarArquivo(primeiro, sessao.chave)).toEqual(CONTEUDO)
    expect(await decifrarArquivo(segundo, sessao.chave)).toEqual(CONTEUDO)
  })

  it('mantém o mesmo salt e iterações ao recifrar com a mesma sessão', async () => {
    const sessao = await sessaoDeTeste()
    const primeiro = lerCabecalho(await cifrarArquivo(CONTEUDO, sessao))
    const segundo = lerCabecalho(await cifrarArquivo(CONTEUDO, sessao))

    expect(segundo.salt).toEqual(primeiro.salt)
    expect(segundo.iteracoes).toBe(primeiro.iteracoes)
  })
})

describe('estaCifrado', () => {
  it('reconhece o container e não confunde arquivo em claro', async () => {
    const sessao = await sessaoDeTeste()

    expect(estaCifrado(await cifrarArquivo(CONTEUDO, sessao))).toBe(true)
    expect(estaCifrado(CONTEUDO)).toBe(false)
    expect(estaCifrado(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(false)
    expect(estaCifrado(new Uint8Array(0))).toBe(false)
  })
})

describe('criarSessao', () => {
  it('usa salt de 16 bytes e 600.000 iterações por padrão', async () => {
    const sessao = await criarSessao('qualquer')

    expect(sessao.salt).toHaveLength(SALT_BYTES)
    expect(sessao.iteracoes).toBe(KDF_ITERACOES)
    expect(sessao.chave.extractable).toBe(false)
    expect(sessao.chave.usages.sort()).toEqual(['decrypt', 'encrypt'])
  })

  it('respeita salt e iterações informados', async () => {
    const salt = new Uint8Array(SALT_BYTES).fill(7)
    const sessao = await criarSessao('senha', { iteracoes: ITERACOES_TESTE, salt })

    expect(sessao.salt).toEqual(salt)
    expect(sessao.iteracoes).toBe(ITERACOES_TESTE)
  })

  it('rejeita senha vazia', async () => {
    await expect(criarSessao('')).rejects.toThrow(/Informe uma senha/)
  })

  it('rejeita salt com tamanho errado', async () => {
    await expect(
      criarSessao('senha', { iteracoes: ITERACOES_TESTE, salt: new Uint8Array(8) }),
    ).rejects.toThrow(/salt/)
  })
})

describe('abrirComSenha', () => {
  it('devolve a sessão com os parâmetros do arquivo e o conteúdo', async () => {
    const sessao = await sessaoDeTeste()
    const cifrado = await cifrarArquivo(CONTEUDO, sessao)

    const aberto = await abrirComSenha(cifrado, SENHA)

    expect(aberto.dados).toEqual(CONTEUDO)
    expect(aberto.sessao.salt).toEqual(sessao.salt)
    expect(aberto.sessao.iteracoes).toBe(sessao.iteracoes)

    const recifrado = await cifrarArquivo(aberto.dados, aberto.sessao)
    expect(await decifrarArquivo(recifrado, sessao.chave)).toEqual(CONTEUDO)
  })

  it('lança ChaveIncorretaError com senha errada', async () => {
    const cifrado = await cifrarArquivo(CONTEUDO, await sessaoDeTeste())

    await expect(abrirComSenha(cifrado, 'errada')).rejects.toBeInstanceOf(ChaveIncorretaError)
  })

  it('lança SenhaVaziaError sem senha', async () => {
    const cifrado = await cifrarArquivo(CONTEUDO, await sessaoDeTeste())

    await expect(abrirComSenha(cifrado, '  ')).rejects.toThrow(/Informe uma senha/)
  })
})

describe('erros exportados', () => {
  it('ChaveNecessariaError tem a mensagem da Fase 3', () => {
    expect(new ChaveNecessariaError().message).toBe(
      'Este banco está criptografado. Informe a chave para continuar.',
    )
  })
})

describe('chaveSessao', () => {
  it('guarda, devolve e esquece a sessão por banco', async () => {
    const sessao = await sessaoDeTeste()
    const id = 'arquivo-123'

    expect(temChave(id)).toBe(false)
    expect(obterChave(id)).toBeNull()

    guardarChave(id, sessao)
    expect(temChave(id)).toBe(true)
    expect(obterChave(id)).toBe(sessao)

    esquecerChave(id)
    expect(temChave(id)).toBe(false)
    expect(obterChave(id)).toBeNull()
  })

  it('isola bancos e esquece todos de uma vez', async () => {
    const primeira = await sessaoDeTeste('a')
    const segunda = await sessaoDeTeste('b')

    guardarChave('banco-a', primeira)
    guardarChave('banco-b', segunda)

    expect(obterChave('banco-a')).toBe(primeira)
    expect(obterChave('banco-b')).toBe(segunda)

    esquecerTodasAsChaves()
    expect(temChave('banco-a')).toBe(false)
    expect(temChave('banco-b')).toBe(false)
  })

  it('substitui a sessão anterior do mesmo banco', async () => {
    const primeira = await sessaoDeTeste('a')
    const segunda = await sessaoDeTeste('b')

    guardarChave('banco', primeira)
    guardarChave('banco', segunda)

    expect(obterChave('banco')).toBe(segunda)
  })
})
