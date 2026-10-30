import { useEffect, useMemo, useState } from 'react'
import { isTesouroDireto } from '@/domain/categoria'
import type { CategoriaAtivo } from '@/domain/entities'
import {
  CATALOGO_TESOURO_DIRETO,
  categoriaListadaNaB3,
  montarSugestoesTicker,
} from '@/domain/tickers'
import type { TickerConhecido } from '@/domain/tickers'
import { listarTickersBrapi } from '@/infrastructure/brapiTickers'

/**
 * Sugestões de ticker para a categoria informada: tickers da carteira +
 * lista da B3 (Brapi, sem token) ou catálogo do Tesouro Direto. Falhas de rede
 * apenas reduzem as sugestões aos tickers já conhecidos.
 */
export function useSugestoesTicker(
  categoria: CategoriaAtivo,
  conhecidos: readonly TickerConhecido[] = [],
): { sugestoes: string[]; carregando: boolean } {
  const [remotos, setRemotos] = useState<{ categoria: CategoriaAtivo; tickers: string[] } | null>(
    null,
  )
  const buscaRemota = categoriaListadaNaB3(categoria)

  useEffect(() => {
    if (!buscaRemota) return
    let ativo = true
    void listarTickersBrapi(categoria).then((tickers) => {
      if (ativo) setRemotos({ categoria, tickers })
    })
    return () => {
      ativo = false
    }
  }, [categoria, buscaRemota])

  const carregando = buscaRemota && remotos?.categoria !== categoria

  const sugestoes = useMemo(() => {
    const externos = isTesouroDireto(categoria)
      ? CATALOGO_TESOURO_DIRETO
      : remotos?.categoria === categoria
        ? remotos.tickers
        : []
    return montarSugestoesTicker(categoria, conhecidos, externos)
  }, [categoria, conhecidos, remotos])

  return { sugestoes, carregando }
}
