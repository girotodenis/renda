import { describe, expect, it } from 'vitest'
import { chaveToken, configDeRegistros, registrosDeConfig } from '@/domain/configuracoes'

describe('configuracoes — tokens por provedor', () => {
  it('lê a chave legada `brapi_token` como token do provedor `brapi`', () => {
    const config = configDeRegistros([
      { chave: ' brapi_token ', valor: ' abc ' },
      { chave: 'outra_api_token', valor: 'xyz' },
      { chave: 'tema', valor: 'escuro' },
      { chave: '_token', valor: 'ignorado' },
    ])
    expect(config.tokens).toEqual({ brapi: 'abc', outra_api: 'xyz' })
  })

  it('grava um registro `<id>_token` por provedor', () => {
    expect(chaveToken('brapi')).toBe('brapi_token')
    expect(registrosDeConfig({ tokens: { brapi: ' abc ', outra: '' } })).toEqual([
      { chave: 'brapi_token', valor: 'abc' },
      { chave: 'outra_token', valor: '' },
    ])
  })
})
