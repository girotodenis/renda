import { fatorQuantidade, isTipoEventoCorporativo } from '@/domain/eventosCorporativos'
import { OperacaoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'
import { round2 } from '@/domain/money'

/**
 * Fluxo de caixa de uma carteira (ou de um ticker) — módulo **puro**.
 *
 * Consolida operações e proventos em um único apanhado financeiro, usado como
 * base do **retorno total** e das rentabilidades ponderadas:
 *
 * - `capitalAportado` = Σ `quantidade × preço + taxas` das compras.
 * - `vendasLiquidas` = Σ `quantidade × preço − taxas` das vendas.
 * - `proventos` = Σ valores creditados no período.
 * - `lucroRealizado` = apurado **venda a venda** pelo custo médio incremental,
 *   já **líquido das taxas de venda**.
 *
 * Convenções do projeto: dinheiro em **centavos**, datas ISO `YYYY-MM-DD`,
 * eventos corporativos ajustam a quantidade sem alterar o custo, e o filtro
 * `ate` (inclusive) permite reconstruir o passado para a série de evolução.
 */

/** Resultado financeiro consolidado do escopo consultado. */
export interface FluxoResultado {
  /** Σ compras (`quantidade × preço + taxas`), em **centavos**. */
  capitalAportado: number
  /** Σ vendas líquidas (`quantidade × preço − taxas`), em **centavos**. */
  vendasLiquidas: number
  /** Σ proventos recebidos, em **centavos**. */
  proventos: number
  /** Lucro apurado nas vendas pelo custo médio incremental, em **centavos**. */
  lucroRealizado: number
  /** Custo da posição atual (`≥ 0`), em **centavos**. */
  custoPosicaoAtual: number
  /** Quantidade da posição atual (compras − vendas + eventos). */
  quantidadePosicao: number
}

/** Filtro opcional do fluxo de caixa. */
export interface FiltroFluxoResultado {
  /** Restringe a um ticker (comparação após `trim`). */
  ticker?: string
}

/** Data usada como "sem limite" (ISO máxima do calendário). */
const SEM_LIMITE = '9999-12-31'

function fluxoVazio(): FluxoResultado {
  return {
    capitalAportado: 0,
    vendasLiquidas: 0,
    proventos: 0,
    lucroRealizado: 0,
    custoPosicaoAtual: 0,
    quantidadePosicao: 0,
  }
}

interface PosicaoEmApuracao {
  quantidade: number
  custo: number
}

/**
 * Fluxo de caixa **acumulado** em cada data de corte informada.
 *
 * `datas` deve estar em ordem **crescente** (cortes inclusivos). Os eventos são
 * percorridos uma única vez, mantendo o custo médio **por ticker** — ideal para
 * séries longas de evolução patrimonial.
 */
export function calcularFluxosAcumulados(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  datas: readonly string[],
  filtro: FiltroFluxoResultado = {},
): FluxoResultado[] {
  const alvo = filtro.ticker?.trim()
  if (alvo !== undefined && alvo.length === 0) return datas.map(() => fluxoVazio())
  if (datas.length === 0) return []

  const doEscopo = operacoes
    .filter((operacao) => operacao.ticker.trim().length > 0)
    .filter((operacao) => (alvo === undefined ? true : operacao.ticker.trim() === alvo))
    .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id))

  const proventosDoEscopo = proventos
    .filter((provento) => provento.ticker.trim().length > 0)
    .filter((provento) => (alvo === undefined ? true : provento.ticker.trim() === alvo))
    .sort((a, b) => a.dataPagamento.localeCompare(b.dataPagamento))

  const posicoes = new Map<string, PosicaoEmApuracao>()
  let capitalAportado = 0
  let vendasLiquidas = 0
  let lucroRealizado = 0
  let proventosRecebidos = 0
  let indiceOperacao = 0
  let indiceProvento = 0

  const montar = (): FluxoResultado => {
    let quantidadePosicao = 0
    let custoPosicaoAtual = 0
    for (const posicao of posicoes.values()) {
      quantidadePosicao += posicao.quantidade
      custoPosicaoAtual += Math.max(posicao.custo, 0)
    }
    return {
      capitalAportado: round2(capitalAportado),
      vendasLiquidas: round2(vendasLiquidas),
      proventos: round2(proventosRecebidos),
      lucroRealizado: round2(lucroRealizado),
      custoPosicaoAtual: round2(custoPosicaoAtual),
      quantidadePosicao: round2(quantidadePosicao),
    }
  }

  const acumulados: FluxoResultado[] = []

  for (const corte of datas) {
    while (indiceOperacao < doEscopo.length && doEscopo[indiceOperacao].data <= corte) {
      const operacao = doEscopo[indiceOperacao]
      indiceOperacao += 1

      const ticker = operacao.ticker.trim()
      const posicao = posicoes.get(ticker) ?? { quantidade: 0, custo: 0 }

      if (isTipoEventoCorporativo(operacao.tipo)) {
        posicao.quantidade = round2(
          posicao.quantidade * fatorQuantidade(operacao.tipo, operacao.quantidade),
        )
        posicoes.set(ticker, posicao)
        continue
      }

      if (operacao.tipo === OperacaoTipo.Venda) {
        // Venda não altera o custo médio: reduz o custo proporcionalmente e o
        // resultado apurado é líquido das taxas pagas na própria venda.
        const custoMedio = posicao.quantidade === 0 ? 0 : posicao.custo / posicao.quantidade
        lucroRealizado +=
          operacao.quantidade * operacao.precoUnitario -
          operacao.quantidade * custoMedio -
          operacao.taxas
        vendasLiquidas += operacao.quantidade * operacao.precoUnitario - operacao.taxas
        posicao.custo -= operacao.quantidade * custoMedio
        posicao.quantidade = round2(posicao.quantidade - operacao.quantidade)
        posicoes.set(ticker, posicao)
        continue
      }

      const custo = operacao.quantidade * operacao.precoUnitario + operacao.taxas
      posicao.custo += custo
      posicao.quantidade = round2(posicao.quantidade + operacao.quantidade)
      capitalAportado += custo
      posicoes.set(ticker, posicao)
    }

    while (
      indiceProvento < proventosDoEscopo.length &&
      proventosDoEscopo[indiceProvento].dataPagamento <= corte
    ) {
      proventosRecebidos += proventosDoEscopo[indiceProvento].valorTotal
      indiceProvento += 1
    }

    acumulados.push(montar())
  }

  return acumulados
}

/**
 * Fluxo de caixa do escopo (carteira inteira ou um ticker) até a data limite
 * informada (`ate`, ISO inclusive; omitida = todos os eventos).
 *
 * A apuração segue a mesma ordem cronológica do consolidado (data e, no
 * empate, `id`), garantindo que o lucro realizado e o custo da posição atual
 * sejam idênticos aos exibidos nas demais telas.
 */
export function calcularFluxoResultado(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[] = [],
  filtro: FiltroFluxoResultado & { ate?: string } = {},
): FluxoResultado {
  const [resultado] = calcularFluxosAcumulados(operacoes, proventos, [filtro.ate ?? SEM_LIMITE], {
    ticker: filtro.ticker,
  })
  return resultado ?? fluxoVazio()
}
