import { CategoriaAtivo } from '@/domain/entities'

/**
 * Sugestões de ticker para o cadastro de operações (autocomplete).
 *
 * Fontes, por categoria:
 * - Ação/FII/BDR/ETF: tickers listados na B3 (API de cotações) + os da carteira.
 * - Tesouro Direto: catálogo local de títulos (não há API pública sem token).
 * - Renda Fixa: apenas os já usados na carteira (produtos não padronizados).
 */

/** Ticker já usado pelo usuário (operações/consolidado). */
export interface TickerConhecido {
  ticker: string
  categoria: CategoriaAtivo
}

/** Famílias de títulos do Tesouro Direto e os vencimentos conhecidos. */
const TESOURO_DIRETO_FAMILIAS: ReadonlyArray<{ nome: string; anos: readonly number[] }> = [
  { nome: 'Tesouro Selic', anos: [2026, 2027, 2028, 2029, 2030, 2031, 2032] },
  { nome: 'Tesouro Prefixado', anos: [2026, 2027, 2028, 2029, 2031, 2032] },
  {
    nome: 'Tesouro Prefixado com Juros Semestrais',
    anos: [2027, 2029, 2031, 2033, 2035, 2037],
  },
  { nome: 'Tesouro IPCA+', anos: [2026, 2029, 2032, 2035, 2040, 2045, 2050] },
  {
    nome: 'Tesouro IPCA+ com Juros Semestrais',
    anos: [2026, 2030, 2032, 2035, 2037, 2040, 2045, 2050, 2055, 2060],
  },
  {
    nome: 'Tesouro Renda+ Aposentadoria Extra',
    anos: [2030, 2035, 2040, 2045, 2050, 2055, 2060, 2065],
  },
  {
    nome: 'Tesouro Educa+',
    anos: [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037, 2038, 2039, 2040, 2041, 2042],
  },
]

/** Catálogo local dos títulos do Tesouro Direto (`"Tesouro Selic 2029"`, ...). */
export const CATALOGO_TESOURO_DIRETO: readonly string[] = TESOURO_DIRETO_FAMILIAS.flatMap(
  ({ nome, anos }) => anos.map((ano) => `${nome} ${ano}`),
)

/** `true` quando a categoria tem lista de tickers na B3 (consultada nas APIs de cotação). */
export function categoriaListadaNaB3(categoria: CategoriaAtivo): boolean {
  return (
    categoria === CategoriaAtivo.Acao ||
    categoria === CategoriaAtivo.Fii ||
    categoria === CategoriaAtivo.Bdr ||
    categoria === CategoriaAtivo.Etf
  )
}

/**
 * Monta a lista de sugestões de uma categoria: primeiro os tickers da carteira
 * (mesma categoria), depois os da fonte externa/catálogo. Duplicatas são
 * removidas sem diferenciar maiúsculas (prevalece a grafia da carteira).
 */
export function montarSugestoesTicker(
  categoria: CategoriaAtivo,
  conhecidos: readonly TickerConhecido[],
  externos: readonly string[],
): string[] {
  const vistos = new Set<string>()
  const locais: string[] = []
  const demais: string[] = []

  const adicionar = (ticker: string, destino: string[]) => {
    const limpo = ticker.trim()
    const chave = limpo.toUpperCase()
    if (limpo.length === 0 || vistos.has(chave)) return
    vistos.add(chave)
    destino.push(limpo)
  }

  for (const item of conhecidos) {
    if (item.categoria === categoria) adicionar(item.ticker, locais)
  }
  for (const ticker of externos) adicionar(ticker, demais)

  const ordenar = (a: string, b: string) => a.localeCompare(b, 'pt-BR')
  return [...locais.sort(ordenar), ...demais.sort(ordenar)]
}
