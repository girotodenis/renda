import { describe, expect, it } from 'vitest'
import {
  CRIPTO_VERSAO,
  CIFRA_NOME,
  CriptografiaInvalidaError,
  IV_BYTES,
  KDF_ITERACOES,
  KDF_NOME,
  MAGIC,
  SALT_BYTES,
  SenhaVaziaError,
  base64ParaBytes,
  bytesParaBase64,
  criptografiaDoArquivo,
  magicBytes,
  montarCabecalho,
  parseCabecalho,
  temMagic,
  validarChave,
} from '@/domain/criptografia'

const SALT = new Uint8Array(Array.from({ length: SALT_BYTES }, (_, i) => i))
const IV = new Uint8Array(Array.from({ length: IV_BYTES }, (_, i) => 255 - i))

/** Cabeçalho válido como objeto, para os testes adulterarem um campo por vez. */
function cabecalhoBruto(): Record<string, unknown> {
  return JSON.parse(montarCabecalho({ iteracoes: 1000, salt: SALT, iv: IV })) as Record<
    string,
    unknown
  >
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor as Record<string, unknown>
}

describe('validarChave', () => {
  it('rejeita senha vazia com a mensagem do plano', () => {
    expect(() => validarChave('')).toThrow(SenhaVaziaError)
    expect(() => validarChave('')).toThrow(
      'Informe uma senha (não há mínimo de tamanho, mas não pode ficar em branco).',
    )
  })

  it('rejeita senha só com espaços', () => {
    expect(() => validarChave('   \t\n ')).toThrow(SenhaVaziaError)
  })

  it('aceita qualquer tamanho, inclusive 1 caractere', () => {
    expect(validarChave('a')).toBe('a')
    expect(validarChave('x'.repeat(200))).toBe('x'.repeat(200))
  })

  it('devolve a senha sem alterar espaços das pontas', () => {
    expect(validarChave('  senha com espaços  ')).toBe('  senha com espaços  ')
  })
})

describe('magic', () => {
  it('expõe o magic ASCII do plano', () => {
    expect(MAGIC).toBe('MINHASACOES-ENC1')
    expect(magicBytes()).toEqual(new Uint8Array([...MAGIC].map((c) => c.charCodeAt(0))))
  })

  it('temMagic reconhece só o prefixo exato', () => {
    expect(temMagic(magicBytes())).toBe(true)
    expect(temMagic(new Uint8Array([...magicBytes(), 0x0a]))).toBe(true)
    expect(temMagic(new Uint8Array([...MAGIC.slice(0, -1)].map((c) => c.charCodeAt(0))))).toBe(
      false,
    )
    expect(temMagic(new TextEncoder().encode(`X${MAGIC}`))).toBe(false)
  })

  it('magicBytes devolve uma cópia (mutar não afeta o módulo)', () => {
    const copia = magicBytes()
    copia[0] = 0
    expect(temMagic(magicBytes())).toBe(true)
  })
})

describe('criptografiaDoArquivo', () => {
  it('detecta o container pelo magic', () => {
    const arquivo = new Uint8Array([...magicBytes(), 0x0a, 0x7b])
    expect(criptografiaDoArquivo(arquivo)).toBe('total')
  })

  it('não confunde gzip nem JSON em claro com arquivo cifrado', () => {
    expect(criptografiaDoArquivo(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe('nenhuma')
    expect(criptografiaDoArquivo(new TextEncoder().encode('{"version":1}'))).toBe('nenhuma')
    expect(criptografiaDoArquivo(new Uint8Array(0))).toBe('nenhuma')
  })
})

describe('Base64', () => {
  it('faz round-trip em tamanhos variados', () => {
    for (const tamanho of [0, 1, 2, 3, 4, 5, 16, 17, 64, 255]) {
      const bytes = new Uint8Array(Array.from({ length: tamanho }, (_, i) => (i * 37 + 11) % 256))
      expect(base64ParaBytes(bytesParaBase64(bytes))).toEqual(bytes)
    }
  })

  it('gera o Base64 padrão conhecido', () => {
    expect(bytesParaBase64(new TextEncoder().encode('Man'))).toBe('TWFu')
    expect(bytesParaBase64(new TextEncoder().encode('Ma'))).toBe('TWE=')
    expect(bytesParaBase64(new TextEncoder().encode('M'))).toBe('TQ==')
    expect(bytesParaBase64(new Uint8Array())).toBe('')
  })

  it('rejeita Base64 inválido', () => {
    expect(() => base64ParaBytes('abc')).toThrow(CriptografiaInvalidaError)
    expect(() => base64ParaBytes('ab$d')).toThrow(CriptografiaInvalidaError)
    expect(() => base64ParaBytes('====')).toThrow(CriptografiaInvalidaError)
    expect(() => base64ParaBytes('a===')).toThrow(CriptografiaInvalidaError)
  })
})

describe('montarCabecalho + parseCabecalho', () => {
  it('monta o formato do plano', () => {
    const json = montarCabecalho({ iteracoes: KDF_ITERACOES, salt: SALT, iv: IV })
    const bruto = comoObjeto(JSON.parse(json))

    expect(bruto.v).toBe(CRIPTO_VERSAO)
    expect(bruto.kdf).toEqual({ n: KDF_NOME, i: KDF_ITERACOES, s: bytesParaBase64(SALT) })
    expect(bruto.cifra).toEqual({ n: CIFRA_NOME, iv: bytesParaBase64(IV) })
  })

  it('faz round-trip preservando salt, IV e o texto original', () => {
    const json = montarCabecalho({ iteracoes: 1000, salt: SALT, iv: IV })
    const cabecalho = parseCabecalho(json)

    expect(cabecalho.versao).toBe(CRIPTO_VERSAO)
    expect(cabecalho.iteracoes).toBe(1000)
    expect(cabecalho.salt).toEqual(SALT)
    expect(cabecalho.iv).toEqual(IV)
    expect(cabecalho.json).toBe(json)
  })

  it('rejeita JSON inválido', () => {
    expect(() => parseCabecalho('não é json')).toThrow(CriptografiaInvalidaError)
    expect(() => parseCabecalho('null')).toThrow(CriptografiaInvalidaError)
  })

  it('rejeita versão não suportada', () => {
    const bruto = cabecalhoBruto()
    bruto.v = 2
    expect(() => parseCabecalho(JSON.stringify(bruto))).toThrow(/não suportada/)
  })

  it('rejeita nomes de algoritmo desconhecidos', () => {
    const kdfErrado = cabecalhoBruto()
    comoObjeto(kdfErrado.kdf).n = 'scrypt'
    expect(() => parseCabecalho(JSON.stringify(kdfErrado))).toThrow(/derivação/)

    const cifraErrada = cabecalhoBruto()
    comoObjeto(cifraErrada.cifra).n = 'AES-256-CBC'
    expect(() => parseCabecalho(JSON.stringify(cifraErrada))).toThrow(/cifra/)
  })

  it('rejeita iterações ausentes, não numéricas ou fora da faixa', () => {
    for (const iteracoes of ['600000', 0, -1, 1.5, 1, 10_000_001, null]) {
      const bruto = cabecalhoBruto()
      comoObjeto(bruto.kdf).i = iteracoes
      expect(() => parseCabecalho(JSON.stringify(bruto))).toThrow(CriptografiaInvalidaError)
    }
  })

  it('rejeita Base64 inválido e tamanhos errados de salt/IV', () => {
    const base64Invalido = cabecalhoBruto()
    comoObjeto(base64Invalido.kdf).s = '###'
    expect(() => parseCabecalho(JSON.stringify(base64Invalido))).toThrow(CriptografiaInvalidaError)

    const saltCurto = cabecalhoBruto()
    comoObjeto(saltCurto.kdf).s = bytesParaBase64(new Uint8Array(8))
    expect(() => parseCabecalho(JSON.stringify(saltCurto))).toThrow(/salt/)

    const ivLongo = cabecalhoBruto()
    comoObjeto(ivLongo.cifra).iv = bytesParaBase64(new Uint8Array(16))
    expect(() => parseCabecalho(JSON.stringify(ivLongo))).toThrow(/IV/)
  })

  it('rejeita cabeçalho sem seções obrigatórias', () => {
    expect(() => parseCabecalho('{"v":1}')).toThrow(CriptografiaInvalidaError)
    expect(() => parseCabecalho('{"v":1,"kdf":{"n":"PBKDF2-SHA256"}}')).toThrow(
      CriptografiaInvalidaError,
    )
  })

  it('montarCabecalho valida os parâmetros antes de gravar', () => {
    expect(() => montarCabecalho({ iteracoes: 1000, salt: SALT, iv: new Uint8Array(8) })).toThrow(
      CriptografiaInvalidaError,
    )
    expect(() => montarCabecalho({ iteracoes: 10, salt: SALT, iv: IV })).toThrow(
      CriptografiaInvalidaError,
    )
    expect(() => montarCabecalho({ versao: 9, iteracoes: 1000, salt: SALT, iv: IV })).toThrow(
      CriptografiaInvalidaError,
    )
  })
})
