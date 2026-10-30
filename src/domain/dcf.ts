import { round2 } from '@/domain/money'

/**
 * Modelo de Fluxo de Caixa Descontado (FCD) — módulo **puro** e testável.
 *
 * Projeta o Fluxo de Caixa Livre (FCL) por `anosProjecao` anos, traz os fluxos
 * a valor presente pela taxa de desconto (WACC) e soma o valor terminal
 * (perpetuidade de Gordon). O valor patrimonial é o valor da firma menos a
 * dívida líquida; o preço justo por ação é o valor patrimonial dividido pela
 * quantidade de ações.
 *
 * Convenções:
 * - Dinheiro em **centavos** (`fclAtual`, `dividaLiquida` e os resultados).
 * - Taxas em pontos percentuais (ex.: `12` = 12% a.a.).
 * - `dividaLiquida` negativa significa caixa líquido (é somada ao valor da firma).
 */

/** Entradas do FCD (valores já validados pela camada de UI). */
export interface DcfInputs {
  /** Fluxo de caixa livre atual (últimos 12 meses), em centavos. */
  fclAtual: number
  /** Dívida líquida (dívida − caixa), em centavos; negativa = caixa líquido. */
  dividaLiquida: number
  /** Quantidade de ações em circulação, em **milhões**. */
  acoesMilhoes: number
  /** Crescimento anual do FCL durante o período de projeção (%). */
  crescimentoAno: number
  /** Taxa de desconto anual — WACC (%). */
  taxaDesconto: number
  /** Período de projeção em anos (inteiro). */
  anosProjecao: number
  /** Crescimento anual na perpetuidade (%). */
  crescimentoPerpetuidade: number
}

/** Um ano da projeção com o fluxo projetado e seu valor presente. */
export interface DcfAnoProjetado {
  ano: number
  /** FCL projetado no ano, em centavos. */
  fluxo: number
  /** Valor presente do fluxo do ano, em centavos. */
  valorPresente: number
}

/** Resultado do FCD (todos os valores em centavos). */
export interface DcfResult {
  /** Valor da firma (enterprise value) = soma dos fluxos + perpetuidade. */
  valorDaFirma: number
  /** Valor patrimonial (equity) = valor da firma − dívida líquida. */
  valorPatrimonio: number
  /** Preço justo por ação, em centavos. */
  precoJusto: number
  /** Projeção ano a ano (fluxo e valor presente). */
  fluxos: DcfAnoProjetado[]
  /** Valor presente do valor terminal (perpetuidade), em centavos. */
  valorPresenteTerminal: number
}

/**
 * Calcula o preço justo por ação pelo FCD. Retorna `null` quando as premissas
 * são matematicamente inválidas (taxa de desconto ≤ 0, ações ≤ 0, taxa de
 * desconto ≤ crescimento na perpetuidade ou período de projeção inválido).
 */
export function calcularFluxoDescontado(inputs: DcfInputs): DcfResult | null {
  const {
    fclAtual,
    dividaLiquida,
    acoesMilhoes,
    crescimentoAno,
    taxaDesconto,
    anosProjecao,
    crescimentoPerpetuidade,
  } = inputs

  if (!Number.isFinite(fclAtual) || fclAtual <= 0) return null
  if (!Number.isFinite(dividaLiquida)) return null
  if (!Number.isFinite(acoesMilhoes) || acoesMilhoes <= 0) return null
  if (!Number.isFinite(taxaDesconto) || taxaDesconto <= 0) return null
  if (!Number.isInteger(anosProjecao) || anosProjecao < 1 || anosProjecao > 50) return null
  if (!Number.isFinite(crescimentoAno)) return null
  if (!Number.isFinite(crescimentoPerpetuidade)) return null

  const taxa = taxaDesconto / 100
  const crescimento = crescimentoAno / 100
  const perpetuidade = crescimentoPerpetuidade / 100

  // Perpetuidade de Gordon exige taxa de desconto > crescimento na perpetuidade.
  if (taxa <= perpetuidade) return null

  const fluxos: DcfAnoProjetado[] = []
  let somaFluxos = 0
  let fluxoAnterior = fclAtual

  for (let ano = 1; ano <= anosProjecao; ano += 1) {
    const fluxo = fluxoAnterior * (1 + crescimento)
    const valorPresente = fluxo / Math.pow(1 + taxa, ano)
    fluxos.push({
      ano,
      fluxo: round2(fluxo),
      valorPresente: round2(valorPresente),
    })
    somaFluxos += valorPresente
    fluxoAnterior = fluxo
  }

  const fluxoTerminal = fluxoAnterior * (1 + perpetuidade)
  const valorTerminal = fluxoTerminal / (taxa - perpetuidade)
  const valorPresenteTerminal = valorTerminal / Math.pow(1 + taxa, anosProjecao)

  const valorDaFirma = somaFluxos + valorPresenteTerminal
  const valorPatrimonio = valorDaFirma - dividaLiquida
  const totalAcoes = acoesMilhoes * 1_000_000
  const precoJusto = Math.round(valorPatrimonio / totalAcoes)

  return {
    valorDaFirma: round2(valorDaFirma),
    valorPatrimonio: round2(valorPatrimonio),
    precoJusto,
    fluxos,
    valorPresenteTerminal: round2(valorPresenteTerminal),
  }
}
