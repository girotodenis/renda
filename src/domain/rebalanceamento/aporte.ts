import { round2 } from '@/lib/money'
import type { AporteOpcoes, Carteira, ItemAporte, MetasPorTicker, PrecoTeto, AporteResult } from './types'

/**
 * Aporte inteligente — modo "apenas aportes" (Seção 5.3) e preço teto
 * (Seção 5.5) — função **pura** e testável.
 *
 * ```
 * Patrimônio Projetado = Patrimônio Atual + Novo Aporte
 * Valor Alvo[i]        = Patrimônio Projetado × Meta%[i]
 * Necessidade[i]       = max(0, Valor Alvo[i] − Valor Atual[i])
 * Aporte Sugerido[i]   ∝ Necessidade[i]
 * Qtd[i]               = floor(Aporte Sugerido[i] / Preço Atual[i])
 * ```
 *
 * O resto do arredondamento é redistribuído iterativamente entre os ativos
 * ainda subalocados; quando não há mais cota comprável, o valor remanescente é
 * reportado como `resto` ("não alocado"). Ativos acima do preço teto são
 * excluídos e o valor é redirecionado aos subalocados elegíveis.
 */

const MAX_ITERACOES = 100

/** Meta efetiva do ativo: override explícito ou, na ausência, o % atual. */
function metaEfetiva(metas: MetasPorTicker, ticker: string, percentualAtual: number): number {
  const meta = metas[ticker]
  return meta === undefined ? percentualAtual : meta
}

/** Quantidade comprável respeitando lote e mercado fracionário. */
function calcularQuantidade(
  valorSugerido: number,
  preco: number,
  lote: number,
  fracionario: boolean,
): number {
  if (preco <= 0 || valorSugerido <= 0) return 0
  const bruto = valorSugerido / preco
  if (fracionario) {
    // Quantidade fracionária: trunca em 4 casas decimais.
    return Math.floor(bruto * 10000) / 10000
  }
  const passo = lote > 0 ? lote : 1
  return Math.floor(bruto / passo) * passo
}

/** `true` quando o ativo está elegível para o aporte (respeitando o preço teto). */
function elegivelAoAporte(preco: number, teto: number | undefined): boolean {
  return preco > 0 && (teto === undefined || teto <= 0 || preco <= teto)
}

/**
 * Distribui um aporte entre os ativos da carteira aproximando-a das metas.
 *
 * @param carteira Posições consolidadas (Seção 5.1).
 * @param metas    Meta % efetiva por ticker (`normalizarMetas`).
 * @param aporte   Valor do aporte em **centavos**.
 * @param precoTeto Preço teto por ticker em **centavos** (opcional — Seção 5.5).
 * @param opcoes   Lote padrão e permissão de fração (Seção 5.3).
 */
export function aporteInteligente(
  carteira: Carteira,
  metas: MetasPorTicker,
  aporte: number,
  precoTeto: PrecoTeto = {},
  opcoes: AporteOpcoes = {},
): AporteResult {
  const lote = opcoes.lote !== undefined && opcoes.lote > 0 ? opcoes.lote : 1
  const fracionario = opcoes.permitirFracionario === true
  const aporteValido = Math.max(0, aporte)

  const patrimonioAtual = round2(carteira.reduce((acc, ativo) => acc + ativo.valorAtual, 0))
  const patrimonioProjetado = round2(patrimonioAtual + aporteValido)

  const ativos = carteira
    .map((ativo) => {
      const ticker = ativo.ticker.trim()
      const percentualAtual =
        patrimonioAtual > 0 ? (ativo.valorAtual / patrimonioAtual) * 100 : 0
      const meta = metaEfetiva(metas, ticker, percentualAtual)
      const valorAlvo = (patrimonioProjetado * meta) / 100
      const teto = precoTeto[ticker]
      return {
        ticker,
        preco: ativo.precoAtual,
        valorAtual: ativo.valorAtual,
        necessidade: Math.max(0, valorAlvo - ativo.valorAtual),
        elegivel: elegivelAoAporte(ativo.precoAtual, teto),
      }
    })
    .filter((ativo) => ativo.ticker.length > 0)

  const necessidades = new Map<string, number>(ativos.map((a) => [a.ticker, a.necessidade]))
  const acumulado = new Map<string, ItemAporte>()
  let alocadoBruto = 0
  let restante = aporteValido
  let iteracoes = 0

  while (restante > 0 && iteracoes < MAX_ITERACOES) {
    iteracoes += 1
    const restanteNoCiclo = restante
    const candidatos = ativos.filter(
      (ativo) => ativo.elegivel && (necessidades.get(ativo.ticker) ?? 0) > 0,
    )
    if (candidatos.length === 0) break

    const totalNecessidade = candidatos.reduce(
      (acc, ativo) => acc + (necessidades.get(ativo.ticker) ?? 0),
      0,
    )

    let alocadoNoCiclo = 0
    for (const ativo of candidatos) {
      const necessidade = necessidades.get(ativo.ticker) ?? 0
      const fracao = totalNecessidade > 0 ? necessidade / totalNecessidade : 1 / candidatos.length
      // Distribui proporcionalmente à necessidade, sem ultrapassar o valor alvo.
      const sugerido = Math.min(restante * fracao, necessidade)
      const qtd = calcularQuantidade(sugerido, ativo.preco, lote, fracionario)
      if (qtd <= 0) continue

      const valor = qtd * ativo.preco
      const item = acumulado.get(ativo.ticker) ?? { ticker: ativo.ticker, qtd: 0, valorAlocado: 0 }
      item.qtd = round2(item.qtd + qtd)
      item.valorAlocado = round2(item.valorAlocado + valor)
      acumulado.set(ativo.ticker, item)
      necessidades.set(ativo.ticker, Math.max(0, necessidade - valor))
      alocadoBruto += valor
      alocadoNoCiclo += valor
    }

    if (alocadoNoCiclo <= 0) break
    const novoRestante = round2(Math.max(0, aporteValido - alocadoBruto))
    // Sem progresso real (arredondamento), interrompe para evitar loop infinito.
    if (novoRestante >= restanteNoCiclo) {
      restante = novoRestante
      break
    }
    restante = novoRestante
  }

  const itens = [...acumulado.values()]
    .map((item) => ({ ...item, valorAlocado: Math.round(item.valorAlocado) }))
    .filter((item) => item.qtd > 0)
    .sort((a, b) => a.ticker.localeCompare(b.ticker))

  const alocadoTotal = itens.reduce((acc, item) => acc + item.valorAlocado, 0)
  const resto = Math.max(0, Math.round(aporteValido - alocadoTotal))

  return Object.assign(itens, { resto })
}
