import { round2 } from '@/lib/money'
import { fatorQuantidade, isTipoEventoCorporativo } from '@/lib/eventosCorporativos'
import type { CategoriaAtivo, Consolidado, Operacao } from '@/types/domain'
import { OperacaoTipo } from '@/types/domain'

/**
 * Fórmulas de cálculo da carteira (Seção 5.1) — módulo **puro** e testável.
 *
 * Para cada ativo `i` (consolidado por ticker):
 * 1. `Qtd_i = Σ Compras − Σ Vendas`
 * 2. `Preço Médio_i = (Σ(Compras×Preço) + Σ Taxas − Σ(Vendas×PreçoVenda)) / Qtd_i`
 * 3. `Total Investido_i = Qtd_i × Preço Médio_i`
 * 4. `Valor Atual_i = Qtd_i × Preço Atual_i`
 * 5. `Lucro_i = Valor Atual_i − Total Investido_i`; `Lucro_i% = Lucro_i / Total Investido_i × 100`
 * 6. `% Carteira_i = Valor Atual_i / Σ Valor Atual × 100`
 *
 * Bordas obrigatórias:
 * - `Qtd_i == 0` → preço médio, total investido e % da carteira são `0`.
 * - Nunca dividir por zero.
 * - Dinheiro em **centavos**; arredondamento explícito com `round2`.
 *
 * Nenhuma dependência de UI/rede: as cotações entram por parâmetro (mapa
 * `ticker → preço atual em centavos`), permitindo testes determinísticos.
 */

/** Posição parcial de um ativo (antes de aplicar o preço atual). */
export interface PosicaoConsolidada {
  ticker: string
  categoria: CategoriaAtivo
  /** Quantidade atual (compras − vendas). */
  quantidadeAtual: number
  /** Preço médio em **centavos** (`0` quando a posição está zerada). */
  precoMedio: number
  /** Total investido em **centavos** (`0` quando a posição está zerada). */
  totalInvestido: number
}

/** Resumo agregado da carteira (base do dashboard — RF07). */
export interface ResumoCarteira {
  /** Σ Valor Atual, em **centavos**. */
  patrimonioTotal: number
  /** Σ Total Investido, em **centavos**. */
  totalInvestido: number
  /** Σ Lucro/Prejuízo, em **centavos**. */
  lucroTotal: number
  /** Rentabilidade geral (%), `0` quando não há capital investido. */
  rentabilidadePercent: number
}

/** Mapa de cotações atuais: `ticker → preço atual em centavos`. */
export type PrecosAtuais = ReadonlyMap<string, number>

interface AcumuladorAtivo {
  ticker: string
  categoria: CategoriaAtivo
  ultimaData: string
  comprasQuantidade: number
  vendasQuantidade: number
  /** Σ (Quantidade × Preço Unitário) das compras, em centavos. */
  comprasValor: number
  /** Σ (Quantidade × Preço Unitário) das vendas, em centavos. */
  vendasValor: number
  /** Σ Taxas (compras + vendas), em centavos. */
  taxas: number
  /**
   * Fator composto dos eventos corporativos (RF20, Seção 5.6). Multiplica a
   * quantidade sem alterar o total investido (`1` = nenhum evento).
   */
  fatorEventos: number
}

function emptyAccumulator(operacao: Operacao): AcumuladorAtivo {
  return {
    ticker: operacao.ticker.trim(),
    categoria: operacao.categoria,
    ultimaData: operacao.data,
    comprasQuantidade: 0,
    vendasQuantidade: 0,
    comprasValor: 0,
    vendasValor: 0,
    taxas: 0,
    fatorEventos: 1,
  }
}

/**
 * Consolida as operações por ticker e calcula quantidade atual, preço médio e
 * total investido (fórmulas 1–3 da Seção 5.1). As taxas entram no custo
 * (somam no numerador do preço médio).
 *
 * Eventos corporativos (RF20, Seção 5.6) são acumulados como um **fator** de
 * quantidade e aplicados ao final — preservando o total investido — de modo
 * que `Qtd × N` e `Preço Médio / N` valham para split, grupamento e
 * bonificação, sem gerar lucro/prejuízo.
 *
 * Operações com ticker vazio são ignoradas. O resultado é ordenado por ticker
 * (determinístico).
 */
export function calcularPosicoes(operacoes: readonly Operacao[]): PosicaoConsolidada[] {
  const acumuladores = new Map<string, AcumuladorAtivo>()

  for (const operacao of operacoes) {
    const ticker = operacao.ticker.trim()
    if (ticker.length === 0) continue

    let acumulador = acumuladores.get(ticker)
    if (!acumulador) {
      acumulador = emptyAccumulator({ ...operacao, ticker })
      acumuladores.set(ticker, acumulador)
    }

    // A categoria exibida é a da operação mais recente (por data ISO).
    if (operacao.data >= acumulador.ultimaData) {
      acumulador.categoria = operacao.categoria
      acumulador.ultimaData = operacao.data
    }

    // Evento corporativo: acumula o fator de quantidade (não altera o custo).
    if (isTipoEventoCorporativo(operacao.tipo)) {
      acumulador.fatorEventos *= fatorQuantidade(operacao.tipo, operacao.quantidade)
      continue
    }

    const quantidade = operacao.quantidade
    const valor = quantidade * operacao.precoUnitario
    if (operacao.tipo === OperacaoTipo.Venda) {
      acumulador.vendasQuantidade += quantidade
      acumulador.vendasValor += valor
    } else {
      acumulador.comprasQuantidade += quantidade
      acumulador.comprasValor += valor
    }
    acumulador.taxas += operacao.taxas
  }

  const posicoes: PosicaoConsolidada[] = []
  for (const acumulador of acumuladores.values()) {
    const quantidadeBase = acumulador.comprasQuantidade - acumulador.vendasQuantidade
    const quantidadeAtual = round2(quantidadeBase * acumulador.fatorEventos)
    const custoTotal =
      acumulador.comprasValor + acumulador.taxas - acumulador.vendasValor

    // Posição zerada: preço médio e total investido são 0 (nunca divide por zero).
    if (quantidadeAtual === 0) {
      posicoes.push({
        ticker: acumulador.ticker,
        categoria: acumulador.categoria,
        quantidadeAtual: 0,
        precoMedio: 0,
        totalInvestido: 0,
      })
      continue
    }

    const precoMedio = round2(custoTotal / quantidadeAtual)
    posicoes.push({
      ticker: acumulador.ticker,
      categoria: acumulador.categoria,
      quantidadeAtual,
      precoMedio,
      totalInvestido: round2(quantidadeAtual * precoMedio),
    })
  }

  return posicoes.sort((a, b) => a.ticker.localeCompare(b.ticker))
}

/**
 * Aplica as cotações atuais às posições e calcula valor atual, lucro (R$ e %)
 * e % da carteira (fórmulas 4–6 da Seção 5.1).
 *
 * Quando a cotação de um ticker não é informada, usa-se o preço médio como
 * fallback (lucro `0`), evitando travar a UI quando o `GOOGLEFINANCE` falha
 * (RNF04). Posições zeradas mantêm preço médio, total investido e % em `0`.
 */
export function aplicarPrecosAtuais(
  posicoes: readonly PosicaoConsolidada[],
  precosAtuais: PrecosAtuais = new Map(),
): Consolidado[] {
  const valorAtualTotal = posicoes.reduce((total, posicao) => {
    const precoAtual = precosAtuais.get(posicao.ticker) ?? posicao.precoMedio
    return total + posicao.quantidadeAtual * precoAtual
  }, 0)

  return posicoes.map((posicao) => {
    const precoAtual = precosAtuais.get(posicao.ticker) ?? posicao.precoMedio
    const valorAtual = round2(posicao.quantidadeAtual * precoAtual)
    const lucroPrejuizo = round2(valorAtual - posicao.totalInvestido)
    const lucroPrejuizoPercent =
      posicao.totalInvestido === 0 ? 0 : round2((lucroPrejuizo / posicao.totalInvestido) * 100)
    const percentualCarteira =
      valorAtualTotal === 0 ? 0 : round2((valorAtual / valorAtualTotal) * 100)

    return {
      ticker: posicao.ticker,
      categoria: posicao.categoria,
      quantidadeAtual: posicao.quantidadeAtual,
      precoMedio: posicao.precoMedio,
      precoAtual,
      totalInvestido: posicao.totalInvestido,
      valorAtual,
      lucroPrejuizo,
      lucroPrejuizoPercent,
      percentualCarteira,
    }
  })
}

/** Atalho: consolida operações e aplica as cotações em uma única chamada. */
export function calcularConsolidado(
  operacoes: readonly Operacao[],
  precosAtuais: PrecosAtuais = new Map(),
): Consolidado[] {
  return aplicarPrecosAtuais(calcularPosicoes(operacoes), precosAtuais)
}

/** Agrega um consolidado no resumo patrimonial (RF07). */
export function calcularResumo(consolidado: readonly Consolidado[]): ResumoCarteira {
  const totais = consolidado.reduce(
    (acc, linha) => ({
      patrimonioTotal: acc.patrimonioTotal + linha.valorAtual,
      totalInvestido: acc.totalInvestido + linha.totalInvestido,
      lucroTotal: acc.lucroTotal + linha.lucroPrejuizo,
    }),
    { patrimonioTotal: 0, totalInvestido: 0, lucroTotal: 0 },
  )

  const patrimonioTotal = round2(totais.patrimonioTotal)
  const totalInvestido = round2(totais.totalInvestido)
  const lucroTotal = round2(totais.lucroTotal)
  const rentabilidadePercent =
    totalInvestido === 0 ? 0 : round2((lucroTotal / totalInvestido) * 100)

  return { patrimonioTotal, totalInvestido, lucroTotal, rentabilidadePercent }
}
