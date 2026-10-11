import { CategoriaAtivo } from '@/types/domain'

/**
 * Helpers do enum canônico `CategoriaAtivo`.
 *
 * Regra: nunca comparar categoria por string solta — use sempre este módulo.
 */

/** Rótulos de exibição (pt-BR) por categoria. */
export const CATEGORIA_ATIVO_LABELS: Record<CategoriaAtivo, string> = {
  [CategoriaAtivo.Acao]: 'Ação',
  [CategoriaAtivo.Fii]: 'FII',
  [CategoriaAtivo.Bdr]: 'BDR',
  [CategoriaAtivo.Etf]: 'ETF',
  [CategoriaAtivo.TesouroDireto]: 'Tesouro Direto',
  [CategoriaAtivo.RendaFixa]: 'Renda Fixa',
}

/** Remove acentos, espaços e caixa para comparações tolerantes. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase()
}

const CATEGORIA_BY_NORMALIZED = new Map<string, CategoriaAtivo>(
  (Object.values(CategoriaAtivo) as CategoriaAtivo[]).flatMap((categoria) => [
    [normalize(categoria), categoria],
    [normalize(CATEGORIA_ATIVO_LABELS[categoria]), categoria],
  ]),
)

/**
 * Converte um valor lido da planilha (código `Acao` ou rótulo `Ação`) na
 * categoria canônica. Retorna `null` quando não reconhecido.
 */
export function parseCategoriaAtivo(value: unknown): CategoriaAtivo | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return CATEGORIA_BY_NORMALIZED.get(normalize(trimmed)) ?? null
}

/** `true` para Renda Fixa (cotação por marcação a mercado, sem `GOOGLEFINANCE`). */
export function isRendaFixa(categoria: CategoriaAtivo): boolean {
  return categoria === CategoriaAtivo.RendaFixa
}

/** `true` para Tesouro Direto (cotação via API de dados abertos / preço manual). */
export function isTesouroDireto(categoria: CategoriaAtivo): boolean {
  return categoria === CategoriaAtivo.TesouroDireto
}

/**
 * `true` para as categorias que aceitam **marcação manual do valor atual**
 * (RF19): Renda Fixa e Tesouro Direto. O valor informado pelo usuário é gravado
 * em `Operacao.valorBrutoAtual` e usado sempre que a integração não retornar
 * cotação — sem ser apagado por falhas de integração.
 */
export function permiteMarcacaoManual(categoria: CategoriaAtivo): boolean {
  return isRendaFixa(categoria) || isTesouroDireto(categoria)
}

/** `true` quando a cotação pode vir do `GOOGLEFINANCE` (Ação, FII, BDR, ETF). */
export function usaGoogFinance(categoria: CategoriaAtivo): boolean {
  return (
    categoria === CategoriaAtivo.Acao ||
    categoria === CategoriaAtivo.Fii ||
    categoria === CategoriaAtivo.Bdr ||
    categoria === CategoriaAtivo.Etf
  )
}

/** Rótulo de exibição (pt-BR) da categoria. */
export function categoriaLabel(categoria: CategoriaAtivo): string {
  return CATEGORIA_ATIVO_LABELS[categoria]
}
