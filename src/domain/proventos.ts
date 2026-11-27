import { fatorQuantidade, isTipoEventoCorporativo } from '@/domain/eventosCorporativos'
import { OperacaoTipo } from '@/domain/entities'
import type { Operacao, Provento } from '@/domain/entities'
import { round2 } from '@/domain/money'

/**
 * Atribuição de proventos ao investidor — módulo **puro** e testável.
 *
 * Um provento pertence a quem detinha a quantidade na **data-com** (data de
 * corte), e não a quem tem posição hoje. Sem esse corte, um provento de um ciclo
 * já encerrado seria contado no ciclo atual (e o mesmo dinheiro poderia ser
 * atribuído duas vezes em visões diferentes).
 *
 * Regras (nesta ordem):
 * 1. **Sem `dataCom`** → não há corte confiável: o valor foi efetivamente
 *    recebido e é atribuído ao investidor (usa `dataPagamento` só para a
 *    quantidade informativa).
 * 2. **Com `dataCom`** → quantidade detida no fechamento dessa data
 *    (`> 0` atribui; `0` não atribui).
 * 3. **Ticker sem nenhuma compra até a `dataCom`** → histórico incompleto (ex.:
 *    banco sem operações, proventos importados de um período anterior): não é
 *    possível provar a ausência de posição, então o provento é mantido.
 *
 * Convenções: datas ISO `YYYY-MM-DD`, dinheiro em **centavos**, eventos
 * corporativos ajustam a quantidade.
 */

/** Provento com a quantidade detida na data de corte. */
export interface ProventoAtribuido {
  provento: Provento
  /** Data usada como corte: `dataCom` ou, na ausência, `dataPagamento`. */
  dataReferencia: string
  /** Quantidade detida no fechamento da data de referência. */
  quantidadeNaData: number
  /** `true` quando o provento pertence ao investidor (ver regras acima). */
  atribuido: boolean
  /** `true` quando a `dataCom` está ausente e a data de pagamento foi usada. */
  usandoDataPagamento: boolean
}

interface OperacaoEmApuracao {
  data: string
  id: string
  tipo: OperacaoTipo
  quantidade: number
}

/**
 * Calcula a quantidade detida (compras − vendas + eventos corporativos) no
 * fechamento de cada `dataCom` dos proventos.
 *
 * Percorre as operações uma única vez por ticker, casando-as em ordem
 * cronológica com os proventos também ordenados — O(n log n) no total.
 */
export function atribuirProventos(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
): ProventoAtribuido[] {
  const operacoesPorTicker = new Map<string, OperacaoEmApuracao[]>()
  for (const operacao of operacoes) {
    const ticker = operacao.ticker.trim()
    if (ticker.length === 0) continue
    const lista = operacoesPorTicker.get(ticker)
    const item: OperacaoEmApuracao = {
      data: operacao.data,
      id: operacao.id,
      tipo: operacao.tipo,
      quantidade: operacao.quantidade,
    }
    if (lista) lista.push(item)
    else operacoesPorTicker.set(ticker, [item])
  }
  for (const lista of operacoesPorTicker.values()) {
    lista.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id))
  }

  const resultado: ProventoAtribuido[] = proventos.map((provento) => ({
    provento,
    dataReferencia: provento.dataCom ?? provento.dataPagamento,
    quantidadeNaData: 0,
    // Ticker vazio não tem como ser avaliado: fica fora dos totais.
    atribuido: false,
    usandoDataPagamento: provento.dataCom === null,
  }))

  const indicesPorTicker = new Map<string, number[]>()
  proventos.forEach((provento, indice) => {
    const ticker = provento.ticker.trim()
    if (ticker.length === 0) return
    const lista = indicesPorTicker.get(ticker)
    if (lista) lista.push(indice)
    else indicesPorTicker.set(ticker, [indice])
  })

  for (const [ticker, indices] of indicesPorTicker) {
    const doTicker = operacoesPorTicker.get(ticker) ?? []
    indices.sort((a, b) => resultado[a].dataReferencia.localeCompare(resultado[b].dataReferencia))

    let cursor = 0
    let quantidade = 0
    let teveCompra = false

    for (const indice of indices) {
      const atribuido = resultado[indice]
      const corte = atribuido.dataReferencia

      while (cursor < doTicker.length && doTicker[cursor].data <= corte) {
        const operacao = doTicker[cursor]
        cursor += 1
        if (isTipoEventoCorporativo(operacao.tipo)) {
          quantidade = round2(quantidade * fatorQuantidade(operacao.tipo, operacao.quantidade))
          continue
        }
        if (operacao.tipo === OperacaoTipo.Venda) {
          quantidade = round2(quantidade - operacao.quantidade)
          continue
        }
        quantidade = round2(quantidade + operacao.quantidade)
        teveCompra = true
      }

      atribuido.quantidadeNaData = quantidade
      atribuido.atribuido = atribuido.usandoDataPagamento || quantidade > 0 || !teveCompra
    }
  }

  return resultado
}

/** Proventos que pertencem ao investidor (filtro da atribuição). */
export function proventosAtribuidos(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
): Provento[] {
  return atribuirProventos(operacoes, proventos)
    .filter((item) => item.atribuido)
    .map((item) => item.provento)
}
