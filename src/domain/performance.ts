import { calcularResumo } from '@/domain/consolidado'
import { OperacaoTipo } from '@/domain/entities'
import type { Consolidado, Operacao, Provento, Snapshot } from '@/domain/entities'
import { proventosAtribuidos } from '@/domain/proventos'

/**
 * Rentabilidade ponderada pelo tempo (**TWR**) e pelo dinheiro (**XIRR/MWR**) —
 * módulo **puro** e testável.
 *
 * As duas métricas respondem perguntas diferentes:
 * - **TWR** isola o desempenho dos ativos do efeito dos aportes/resgates.
 * - **XIRR** mede o retorno efetivo do dinheiro, considerando tamanho e data de
 *   cada fluxo.
 *
 * Modelo de fluxo do app: a carteira é composta **apenas pelas posições
 * acompanhadas** (não há conta-corrente de caixa). Assim:
 * - compra = **aporte** (dinheiro entra na carteira);
 * - venda = **resgate** (dinheiro sai);
 * - provento = **resgate** (o valor sai da carteira ao ser creditado).
 *
 * Convenções: dinheiro em **centavos**, datas ISO `YYYY-MM-DD`, taxas
 * devolvidas em **decimal** (ex.: `0.0706` = 7,06% a.a.) e `null` quando não é
 * possível calcular (sem fluxos de sinais opostos, sem janela de valores etc.).
 */

/** Fluxo de caixa datado, em **centavos** (perspectiva do investidor). */
export interface FluxoDatado {
  /** ISO `YYYY-MM-DD`. */
  data: string
  /** Positivo = recebimento; negativo = desembolso. */
  valor: number
}

/** Subperíodo de avaliação do TWR. */
export interface Subperiodo {
  /** ISO `YYYY-MM-DD` (início, exclusive para os fluxos). */
  dataInicial: string
  /** ISO `YYYY-MM-DD` (fim, inclusive para os fluxos). */
  dataFinal: string
  /** Valor de mercado no início, em **centavos**. */
  valorInicial: number
  /** Valor de mercado no fim, em **centavos**. */
  valorFinal: number
  /** Fluxo líquido do período: aportes (+) menos resgates (−), em **centavos**. */
  fluxoLiquido: number
}

/** Resultado do TWR. */
export interface ResultadoTwr {
  /** Retorno acumulado do período (decimal). */
  acumulado: number
  /** Retorno anualizado (decimal), `null` sem período positivo. */
  anualizado: number | null
  /** Dias efetivamente encadeados. */
  dias: number
  /** Quantos subperíodos entraram no encadeamento. */
  subperiodos: number
}

/** Desempenho consolidado de um período. */
export interface Desempenho {
  /** XIRR anual (decimal) ou `null` sem fluxos de sinais opostos. */
  xirr: number | null
  /** TWR acumulado (decimal) ou `null` sem subperíodos válidos. */
  twr: number | null
  /** TWR anualizado (decimal) ou `null`. */
  twrAnualizado: number | null
  /** Início e fim da janela do TWR (ISO), `null` sem histórico. */
  inicio: string | null
  fim: string | null
}

const DIA_MS = 86_400_000

/** Timestamp UTC de uma data ISO (evita deslocamento de fuso). */
function timestamp(iso: string): number {
  const [ano, mes, dia] = iso.split('-').map(Number)
  return Date.UTC(ano, mes - 1, dia)
}

/** Dias corridos entre duas datas ISO (`fim − inicio`). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((timestamp(fim) - timestamp(inicio)) / DIA_MS)
}

/** Soma os fluxos da mesma data (mantém a ordem cronológica). */
function consolidarPorData(fluxos: readonly FluxoDatado[]): FluxoDatado[] {
  const porData = new Map<string, number>()
  for (const fluxo of fluxos) {
    if (fluxo.data.length === 0 || !Number.isFinite(fluxo.valor) || fluxo.valor === 0) continue
    porData.set(fluxo.data, (porData.get(fluxo.data) ?? 0) + fluxo.valor)
  }
  return [...porData.entries()]
    .map(([data, valor]) => ({ data, valor }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

/**
 * Valor presente líquido dos fluxos a uma taxa anual `taxa` (decimal),
 * descontando por dias corridos / 365 a partir do primeiro fluxo.
 */
export function valorPresenteLiquido(fluxos: readonly FluxoDatado[], taxa: number): number {
  if (fluxos.length === 0) return 0
  const inicio = fluxos[0].data
  let vpl = 0
  for (const fluxo of fluxos) {
    const expoente = diasEntre(inicio, fluxo.data) / 365
    vpl += fluxo.valor / Math.pow(1 + taxa, expoente)
  }
  return vpl
}

/**
 * **XIRR** — taxa interna de retorno anual com datas exatas.
 *
 * Resolve `VPL(taxa) = 0` por bissecção (estável e determinística), com bracket
 * que se expande até achar troca de sinal. Devolve `null` quando:
 * - há menos de dois fluxos ou todos têm o mesmo sinal (não há raiz);
 * - não existe taxa em `(-100%, +∞)` que zere o VPL.
 */
export function xirr(fluxos: readonly FluxoDatado[]): number | null {
  const ordenados = consolidarPorData(fluxos)
  if (ordenados.length < 2) return null

  let temPositivo = false
  let temNegativo = false
  for (const fluxo of ordenados) {
    if (fluxo.valor > 0) temPositivo = true
    else if (fluxo.valor < 0) temNegativo = true
  }
  if (!temPositivo || !temNegativo) return null

  const vpl = (taxa: number): number => valorPresenteLiquido(ordenados, taxa)

  // Limites de base (1+r) que evitam underflow/overflow nas potências: o
  // expoente máximo é o horizonte da série em anos, e mantemos as potências
  // numa faixa segura de doubles (10^±250).
  const horizonteAnos = Math.max(
    diasEntre(ordenados[0].data, ordenados[ordenados.length - 1].data) / 365,
    1 / 365,
  )
  const baseMinima = Math.pow(10, -250 / horizonteAnos)
  const baseMaxima = Math.pow(10, 250 / horizonteAnos)

  let baixo = Math.max(-0.999999, baseMinima - 1)
  let alto = 1
  let fBaixo = vpl(baixo)
  let fAlto = vpl(alto)
  if (Number.isNaN(fBaixo) || Number.isNaN(fAlto)) return null

  const limiteAlto = Math.max(baseMaxima - 1, 1)
  let expansoes = 0
  while (fBaixo * fAlto > 0 && alto < limiteAlto && expansoes < 80) {
    alto = Math.min(alto * 2, limiteAlto)
    fAlto = vpl(alto)
    if (Number.isNaN(fAlto)) return null
    expansoes += 1
  }
  if (!(fBaixo * fAlto <= 0)) return null

  for (let iteracao = 0; iteracao < 300; iteracao += 1) {
    const meio = (baixo + alto) / 2
    if (meio === baixo || meio === alto) break
    const fMeio = vpl(meio)
    if (fMeio === 0) return meio
    if (fBaixo * fMeio < 0) {
      alto = meio
      fAlto = fMeio
    } else {
      baixo = meio
      fBaixo = fMeio
    }
  }

  return (baixo + alto) / 2
}

/**
 * **TWR** — encadeia geometricamente os subperíodos:
 *
 * `r_i = (V_final,i − Fluxo_i) ÷ V_inicial,i − 1`
 * `TWR = Π(1 + r_i) − 1`
 *
 * Subperíodos com `valorInicial <= 0` são ignorados (não há base para o
 * retorno). Devolve `null` quando nenhum subperíodo é utilizável.
 */
export function twr(subperiodos: readonly Subperiodo[]): ResultadoTwr | null {
  let fator = 1
  let dias = 0
  let usados = 0

  for (const subperiodo of subperiodos) {
    if (!(subperiodo.valorInicial > 0)) continue
    const retorno = (subperiodo.valorFinal - subperiodo.fluxoLiquido) / subperiodo.valorInicial - 1
    if (!Number.isFinite(retorno)) continue
    fator *= 1 + retorno
    dias += Math.max(diasEntre(subperiodo.dataInicial, subperiodo.dataFinal), 0)
    usados += 1
  }

  if (usados === 0) return null

  const acumulado = fator - 1
  const anualizado = dias > 0 && fator > 0 ? Math.pow(fator, 365 / dias) - 1 : null
  return { acumulado, anualizado, dias, subperiodos: usados }
}

/** Entrada para montar os fluxos do XIRR. */
export interface EntradaFluxosXirr {
  operacoes: readonly Operacao[]
  proventos: readonly Provento[]
  /** Valor de mercado atual da posição/carteira, em **centavos**. */
  valorFinal: number
  /** Data de referência (ISO) — o valor final entra nessa data. */
  dataFinal: string
  /** Restringe a um ticker (comparação após `trim`). */
  ticker?: string
}

/**
 * Fluxos para o XIRR: compras (−), vendas (+), proventos atribuídos (+) e o
 * **valor de mercado final** (+) na data de referência.
 */
export function fluxosParaXirr(entrada: EntradaFluxosXirr): FluxoDatado[] {
  const alvo = entrada.ticker?.trim()
  const fluxos: FluxoDatado[] = []

  for (const operacao of entrada.operacoes) {
    const ticker = operacao.ticker.trim()
    if (ticker.length === 0) continue
    if (alvo !== undefined && ticker !== alvo) continue
    if (operacao.data > entrada.dataFinal) continue

    if (operacao.tipo === OperacaoTipo.Venda) {
      fluxos.push({
        data: operacao.data,
        valor: operacao.quantidade * operacao.precoUnitario - operacao.taxas,
      })
      continue
    }
    if (operacao.tipo === OperacaoTipo.Compra) {
      fluxos.push({
        data: operacao.data,
        valor: -(operacao.quantidade * operacao.precoUnitario + operacao.taxas),
      })
    }
    // Eventos corporativos não movimentam caixa.
  }

  for (const provento of proventosAtribuidos(entrada.operacoes, entrada.proventos)) {
    const ticker = provento.ticker.trim()
    if (ticker.length === 0) continue
    if (alvo !== undefined && ticker !== alvo) continue
    if (provento.dataPagamento > entrada.dataFinal) continue
    fluxos.push({ data: provento.dataPagamento, valor: provento.valorTotal })
  }

  if (entrada.valorFinal > 0) {
    fluxos.push({ data: entrada.dataFinal, valor: entrada.valorFinal })
  }

  return consolidarPorData(fluxos)
}

/**
 * Subperíodos do TWR a partir do `Historico`: cada intervalo entre dois
 * snapshots vira um subperíodo, com o fluxo líquido (aportes − resgates) do
 * intervalo. Snapshots repetidos na mesma data mantêm o último.
 */
export function subperiodosDaCarteira(
  historico: readonly Snapshot[],
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
): Subperiodo[] {
  const porData = new Map<string, Snapshot>()
  for (const snapshot of historico) {
    if (snapshot.data.length === 0) continue
    porData.set(snapshot.data, snapshot)
  }
  const snapshots = [...porData.values()].sort((a, b) => a.data.localeCompare(b.data))
  if (snapshots.length < 2) return []

  const movimentos: { data: string; valor: number }[] = []
  for (const operacao of operacoes) {
    if (operacao.ticker.trim().length === 0) continue
    if (operacao.tipo === OperacaoTipo.Compra) {
      movimentos.push({
        data: operacao.data,
        valor: operacao.quantidade * operacao.precoUnitario + operacao.taxas,
      })
    } else if (operacao.tipo === OperacaoTipo.Venda) {
      movimentos.push({
        data: operacao.data,
        valor: -(operacao.quantidade * operacao.precoUnitario - operacao.taxas),
      })
    }
  }
  for (const provento of proventosAtribuidos(operacoes, proventos)) {
    if (provento.ticker.trim().length === 0) continue
    movimentos.push({ data: provento.dataPagamento, valor: -provento.valorTotal })
  }
  movimentos.sort((a, b) => a.data.localeCompare(b.data))

  const subperiodos: Subperiodo[] = []
  let cursor = 0
  for (let indice = 1; indice < snapshots.length; indice += 1) {
    const anterior = snapshots[indice - 1]
    const atual = snapshots[indice]
    let fluxoLiquido = 0
    while (cursor < movimentos.length && movimentos[cursor].data <= anterior.data) {
      cursor += 1
    }
    while (cursor < movimentos.length && movimentos[cursor].data <= atual.data) {
      fluxoLiquido += movimentos[cursor].valor
      cursor += 1
    }
    subperiodos.push({
      dataInicial: anterior.data,
      dataFinal: atual.data,
      valorInicial: anterior.patrimonioTotal,
      valorFinal: atual.patrimonioTotal,
      fluxoLiquido,
    })
  }

  return subperiodos
}

/** Desempenho da carteira: XIRR (dinheiro) e TWR (ativos). */
export function desempenhoDaCarteira(
  consolidado: readonly Consolidado[],
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  historico: readonly Snapshot[],
  dataReferencia: string,
): Desempenho {
  const { patrimonioTotal } = calcularResumo(consolidado)
  const fluxos = fluxosParaXirr({
    operacoes,
    proventos,
    valorFinal: patrimonioTotal,
    dataFinal: dataReferencia,
  })
  const janela = subperiodosDaCarteira(historico, operacoes, proventos)
  const resultadoTwr = twr(janela)

  return {
    xirr: xirr(fluxos),
    twr: resultadoTwr?.acumulado ?? null,
    twrAnualizado: resultadoTwr?.anualizado ?? null,
    inicio: janela[0]?.dataInicial ?? null,
    fim: janela[janela.length - 1]?.dataFinal ?? null,
  }
}
