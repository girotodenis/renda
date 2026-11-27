import { calcularResumo } from '@/domain/consolidado'
import { calcularFluxoResultado } from '@/domain/fluxoCaixa'
import { round2 } from '@/domain/money'
import { proventosAtribuidos } from '@/domain/proventos'
import type { CategoriaAtivo, Consolidado, Operacao, Provento } from '@/domain/entities'

/**
 * Resultado da carteira em **retorno total** — módulo **puro**.
 *
 * Complementa o resumo patrimonial (que mede apenas a **variação de preço** das
 * posições abertas) somando o que o padrão profissional exige:
 *
 * `Retorno Total = variação de preço (não realizada) + lucro realizado + proventos`
 *
 * - O **lucro realizado** vem do fluxo de caixa (`domain/fluxoCaixa.ts`), já
 *   líquido das taxas de venda.
 * - A **rentabilidade total** usa o capital aportado (Σ compras com taxas) como
 *   base — a mesma base da visão "Rentabilidade Total" do detalhe do ativo.
 * - Proventos de posições já encerradas entram no resultado mesmo sem posição
 *   atual. A atribuição por **data-com** (posição detida no evento) ainda não é
 *   aplicada: todo provento do escopo conta no período em que foi creditado.
 *
 * Convenções: centavos inteiros, `round2`, nunca dividir por zero.
 */

/** Resumo da carteira em retorno total. */
export interface ResumoResultado {
  /** Σ valor atual das posições abertas, em **centavos**. */
  patrimonioTotal: number
  /** Σ custo das posições abertas, em **centavos**. */
  totalInvestido: number
  /** Variação de preço das posições abertas (lucro não realizado), em **centavos**. */
  variacaoPreco: number
  /** Rentabilidade da variação de preço sobre o custo das posições abertas (%). */
  rentabilidadePrecoPercent: number
  /** Lucro apurado nas vendas (líquido de taxas), em **centavos**. */
  lucroRealizado: number
  /** Proventos recebidos, em **centavos**. */
  proventos: number
  /** Σ compras com taxas (base das rentabilidades ponderadas), em **centavos**. */
  capitalAportado: number
  /** `variação de preço + lucro realizado + proventos`, em **centavos**. */
  retornoTotal: number
  /** Rentabilidade total sobre o capital aportado (%). */
  rentabilidadeTotalPercent: number
}

/**
 * Consolida o resultado da carteira (posições abertas + ciclos encerrados +
 * proventos) até a data limite informada.
 *
 * `ate` (ISO, inclusive) permite reconstruir períodos passados para a série de
 * evolução patrimonial.
 */
export function calcularResultado(
  consolidado: readonly Consolidado[],
  operacoes: readonly Operacao[] = [],
  proventos: readonly Provento[] = [],
  ate?: string,
): ResumoResultado {
  const resumo = calcularResumo(consolidado)
  // Só entram os proventos atribuídos ao investidor na data-com (ver
  // `domain/proventos.ts`); os demais pertencem a ciclos de outra pessoa/período.
  const fluxo = calcularFluxoResultado(operacoes, proventosAtribuidos(operacoes, proventos), {
    ate,
  })
  const retornoTotal = round2(resumo.lucroTotal + fluxo.lucroRealizado + fluxo.proventos)

  return {
    patrimonioTotal: resumo.patrimonioTotal,
    totalInvestido: resumo.totalInvestido,
    variacaoPreco: resumo.lucroTotal,
    rentabilidadePrecoPercent: resumo.rentabilidadePercent,
    lucroRealizado: fluxo.lucroRealizado,
    proventos: fluxo.proventos,
    capitalAportado: fluxo.capitalAportado,
    retornoTotal,
    rentabilidadeTotalPercent:
      fluxo.capitalAportado === 0 ? 0 : round2((retornoTotal / fluxo.capitalAportado) * 100),
  }
}

/** Resultado consolidado de um ativo **completamente vendido**. */
export interface ResultadoEncerrado {
  ticker: string
  categoria: CategoriaAtivo
  /** Σ compras com taxas, em **centavos**. */
  capitalAportado: number
  /** Lucro das vendas, líquido de taxas, em **centavos**. */
  lucroRealizado: number
  /** Proventos atribuídos ao investidor, em **centavos**. */
  proventos: number
  /** `lucroRealizado + proventos`, em **centavos**. */
  resultado: number
  /** Resultado sobre o capital aportado (%). */
  resultadoPercent: number
}

/**
 * Resultado dos ativos com posição **zerada** (aba "Vendidos").
 *
 * O `Consolidado` de uma posição encerrada é todo zerado, então a tabela de
 * vendidos não tem o que exibir sem esta apuração: aqui o resultado vem do
 * fluxo de caixa (vendas líquidas de taxas) somado aos proventos atribuídos ao
 * investidor na data-com.
 */
export function resultadosDeEncerrados(
  consolidado: readonly Consolidado[],
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
): Map<string, ResultadoEncerrado> {
  const proventosPorTicker = new Map<string, number>()
  for (const provento of proventosAtribuidos(operacoes, proventos)) {
    const ticker = provento.ticker.trim()
    proventosPorTicker.set(ticker, (proventosPorTicker.get(ticker) ?? 0) + provento.valorTotal)
  }

  const resultados = new Map<string, ResultadoEncerrado>()
  for (const linha of consolidado) {
    const ticker = linha.ticker.trim()
    if (ticker.length === 0 || linha.quantidadeAtual !== 0) continue

    const fluxo = calcularFluxoResultado(operacoes, [], { ticker })
    const proventosDoTicker = round2(proventosPorTicker.get(ticker) ?? 0)
    const resultado = round2(fluxo.lucroRealizado + proventosDoTicker)

    resultados.set(ticker, {
      ticker,
      categoria: linha.categoria,
      capitalAportado: fluxo.capitalAportado,
      lucroRealizado: fluxo.lucroRealizado,
      proventos: proventosDoTicker,
      resultado,
      resultadoPercent:
        fluxo.capitalAportado === 0 ? 0 : round2((resultado / fluxo.capitalAportado) * 100),
    })
  }

  return resultados
}
