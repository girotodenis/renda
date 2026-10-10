import type { AgregadoProvento } from '@/lib/dashboard'
import { formatarMesAnoBR, toISO } from '@/lib/dates'
import { fatorQuantidade, isTipoEventoCorporativo } from '@/lib/eventosCorporativos'
import { round2 } from '@/lib/money'
import { OperacaoTipo } from '@/types/domain'
import type { CategoriaAtivo, Consolidado, Operacao, Provento } from '@/types/domain'

/**
 * Detalhe de um ativo por ticker (RF10 — modal do Dashboard) — módulo **puro** e
 * testável. Nenhuma dependência de UI/rede: recebe as operações, os proventos e
 * o consolidado já carregados (cache-first) e devolve as métricas do ativo.
 *
 * Convenções: dinheiro em **centavos**; datas ISO `YYYY-MM-DD`; percentuais com
 * `round2`; nunca dividir por zero.
 *
 * Visões de rentabilidade:
 * - **Posição**: `(variação do preço + proventos do período) ÷ valor investido`.
 * - **Total (fluxo de caixa)**: `(lucro realizado + lucro flutuante + proventos) ÷ capital aportado`.
 *
 * Sobre o **lucro realizado/flutuante**, usa-se o **custo médio incremental**:
 * o lucro realizado é apurado venda a venda contra o custo médio do momento e o
 * lucro flutuante é `valor atual − custo da posição atual`; a soma dos dois é
 * equivalente a `valor atual − valor investido`. Quando não há operações em
 * cache (posição vinda só da aba `Consolidado`), cai-se para
 * `Consolidado.lucroPrejuizo` como lucro flutuante.
 */

/** Detalhe calculado de um ativo (todas as métricas do modal em centavos/%). */
export interface DetalheAtivo {
  ticker: string
  categoria: CategoriaAtivo
  /** Menor preço unitário entre as compras (centavos) — `null` se sem compras. */
  menorPrecoCompra: number | null
  /** Maior preço unitário entre as compras (centavos) — `null` se sem compras. */
  maiorPrecoCompra: number | null
  /** Data ISO da primeira compra — `null` se sem compras. */
  primeiraCompra: string | null
  /** Data ISO da última compra — `null` se sem compras. */
  ultimaCompra: string | null
  /**
   * Data de referência (ISO) usada como **fim da janela de proventos**
   * (`[1ª compra, data de referência]`, padrão: hoje).
   */
  dataReferencia: string
  /** Preço médio em centavos (vem do `Consolidado`). */
  precoMedio: number
  /** Preço atual (cotação) em centavos (vem do `Consolidado`). */
  precoAtual: number
  /** Total investido em centavos (vem do `Consolidado`). */
  totalInvestido: number
  /** Valor atual em centavos (vem do `Consolidado`). */
  valorAtual: number
  /** Proventos recebidos na janela 1ª compra → data de referência, em centavos. */
  proventosNoPeriodo: number
  /** Retorno da posição em centavos (`valorAtual − totalInvestido + proventos`). */
  retornoPosicao: number
  /** Rentabilidade da posição (%) — inclui proventos do período. */
  rentabilidadePercent: number
  /** Capital aportado em compras (Σ quantidade × preço + taxas), em centavos. */
  capitalAportado: number
  /** Lucro realizado acumulado (custo médio incremental), em centavos. */
  lucroRealizado: number
  /** Lucro flutuante da posição atual (`valorAtual − custo da posição`), centavos. */
  lucroFlutuante: number
  /** `lucroRealizado + lucroFlutuante + proventos`, em centavos. */
  retornoTotal: number
  /** Rentabilidade Total (fluxo de caixa) sobre o capital aportado, em %. */
  rentabilidadeTotalPercent: number
}

/** Resultado do fluxo de caixa incremental de um ticker. */
export interface FluxoRealizado {
  /** Soma dos lucros apurados nas vendas, em centavos. */
  lucroRealizado: number
  /** Custo da posição atual (base do lucro flutuante), em centavos. */
  custoPosicaoAtual: number
  /** Quantidade da posição atual (compras − vendas + eventos). */
  quantidadePosicao: number
}

/** Ponto do waterfall de decomposição do retorno. */
export interface PontoDecomposicao {
  /** Rótulo de exibição (pt-BR). */
  rotulo: string
  /** Altura da barra (pode ser negativa), em centavos. */
  valor: number
  /** Deslocamento invisível para o efeito cascata, em centavos. */
  base: number
  /** Total acumulado após este passo, em centavos. */
  acumulado: number
}

function normalizar(valor: string): string {
  return valor.trim()
}

/**
 * Apura o **lucro realizado** (custo médio incremental) e o **custo da posição
 * atual** de um ticker (Seção 4.1 da especificação).
 *
 * Regras:
 * 1. Ordena as operações do ticker por `data` (desempate por `id`).
 * 2. Compra: `custoTotal += qty × preço + taxas` e `qtd += qty`.
 * 3. Evento corporativo: aplica o fator de quantidade sem alterar o `custoTotal`.
 * 4. Venda: `custoMédio = custoTotal / qtd` (0 quando `qtd === 0`); acumula
 *    `lucroRealizado += qty × preçoVenda − qty × custoMédio`; reduz `custoTotal`
 *    em `qty × custoMédio` e `qtd` em `qty`.
 */
export function calcularFluxoRealizado(
  ticker: string,
  operacoes: readonly Operacao[],
): FluxoRealizado {
  const alvo = normalizar(ticker)
  const doTicker = operacoes
    .filter((operacao) => normalizar(operacao.ticker) === alvo)
    .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id))

  let qtdCarteira = 0
  let custoTotal = 0
  let lucroRealizado = 0

  for (const operacao of doTicker) {
    if (isTipoEventoCorporativo(operacao.tipo)) {
      qtdCarteira = round2(qtdCarteira * fatorQuantidade(operacao.tipo, operacao.quantidade))
      continue
    }

    if (operacao.tipo === OperacaoTipo.Compra) {
      custoTotal += operacao.quantidade * operacao.precoUnitario + operacao.taxas
      qtdCarteira = round2(qtdCarteira + operacao.quantidade)
      continue
    }

    // Venda — apura o lucro contra o custo médio do momento (nunca divide por zero).
    const custoMedio = qtdCarteira === 0 ? 0 : custoTotal / qtdCarteira
    lucroRealizado += operacao.quantidade * operacao.precoUnitario - operacao.quantidade * custoMedio
    custoTotal -= operacao.quantidade * custoMedio
    qtdCarteira = round2(qtdCarteira - operacao.quantidade)
  }

  return {
    lucroRealizado: round2(lucroRealizado),
    custoPosicaoAtual: round2(Math.max(custoTotal, 0)),
    quantidadePosicao: qtdCarteira,
  }
}

/** Proventos do ticker cujo `dataPagamento` cai na janela `[dataInicio, dataFim]` inclusiva. */
export function filtrarProventosDoTicker(
  ticker: string,
  proventos: readonly Provento[],
  dataInicio: string | null,
  dataFim: string | null,
): Provento[] {
  if (dataInicio === null || dataFim === null) return []
  const alvo = normalizar(ticker)
  return proventos.filter(
    (provento) =>
      normalizar(provento.ticker) === alvo &&
      provento.dataPagamento >= dataInicio &&
      provento.dataPagamento <= dataFim,
  )
}

/**
 * Calcula o detalhe de um ativo (RF10). Retorna `null` quando o ticker não tem
 * compras nem posição no consolidado (evita modal vazia) ou é vazio.
 *
 * Os proventos entram na janela `[1ª compra, dataReferencia]` (fim = hoje por
 * padrão), de modo que proventos recebidos após a última compra continuem
 * contando.
 */
export function calcularDetalheAtivo(
  ticker: string,
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  consolidado: readonly Consolidado[],
  dataReferencia: string = toISO(new Date()),
): DetalheAtivo | null {
  const alvo = normalizar(ticker)
  if (alvo.length === 0) return null

  const doTicker = operacoes.filter((operacao) => normalizar(operacao.ticker) === alvo)
  const compras = doTicker.filter((operacao) => operacao.tipo === OperacaoTipo.Compra)
  const linha = consolidado.find((item) => normalizar(item.ticker) === alvo) ?? null

  if (compras.length === 0 && linha === null) return null

  let menorPrecoCompra: number | null = null
  let maiorPrecoCompra: number | null = null
  let primeira: Operacao | null = null

  for (const compra of compras) {
    menorPrecoCompra =
      menorPrecoCompra === null ? compra.precoUnitario : Math.min(menorPrecoCompra, compra.precoUnitario)
    maiorPrecoCompra =
      maiorPrecoCompra === null ? compra.precoUnitario : Math.max(maiorPrecoCompra, compra.precoUnitario)
    if (
      primeira === null ||
      compra.data < primeira.data ||
      (compra.data === primeira.data && compra.id < primeira.id)
    ) {
      primeira = compra
    }
  }

  const primeiraCompra = primeira?.data ?? null
  const ultimaCompra = compras.reduce<string | null>(
    (max, compra) => (max === null || compra.data > max ? compra.data : max),
    null,
  )
  const capitalAportado = round2(
    compras.reduce(
      (soma, compra) => soma + compra.quantidade * compra.precoUnitario + compra.taxas,
      0,
    ),
  )

  const proventosNoPeriodo = round2(
    filtrarProventosDoTicker(alvo, proventos, primeiraCompra, dataReferencia).reduce(
      (soma, provento) => soma + provento.valorTotal,
      0,
    ),
  )

  const precoMedio = linha?.precoMedio ?? 0
  const precoAtual = linha?.precoAtual ?? 0
  const totalInvestido = linha?.totalInvestido ?? 0
  const valorAtual = linha?.valorAtual ?? 0

  const retornoPosicao = round2(valorAtual - totalInvestido + proventosNoPeriodo)
  const rentabilidadePercent =
    totalInvestido === 0 ? 0 : round2((retornoPosicao / totalInvestido) * 100)

  const fluxo = calcularFluxoRealizado(alvo, operacoes)
  const lucroFlutuante =
    doTicker.length > 0
      ? round2(valorAtual - fluxo.custoPosicaoAtual)
      : (linha?.lucroPrejuizo ?? 0)
  const lucroRealizado = fluxo.lucroRealizado
  const retornoTotal = round2(lucroRealizado + lucroFlutuante + proventosNoPeriodo)
  const rentabilidadeTotalPercent =
    capitalAportado === 0 ? 0 : round2((retornoTotal / capitalAportado) * 100)

  const operacaoRecente = [...doTicker].sort(
    (a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id),
  )[0]
  const categoria = linha?.categoria ?? compras[0]?.categoria ?? operacaoRecente?.categoria
  if (categoria === undefined) return null

  return {
    ticker: alvo,
    categoria,
    menorPrecoCompra,
    maiorPrecoCompra,
    primeiraCompra,
    ultimaCompra,
    dataReferencia,
    precoMedio,
    precoAtual,
    totalInvestido,
    valorAtual,
    proventosNoPeriodo,
    retornoPosicao,
    rentabilidadePercent,
    capitalAportado,
    lucroRealizado,
    lucroFlutuante,
    retornoTotal,
    rentabilidadeTotalPercent,
  }
}

/**
 * Série do waterfall de decomposição do retorno:
 * `Valor investido → + Lucro realizado → + Variação → + Proventos → Patrimônio final`,
 * onde `patrimônioFinal = valor investido + lucro realizado + variação + proventos`
 * (equivale a `valor atual + proventos`).
 *
 * O `valor investido` da série é o **capital líquido aportado**
 * (`valor atual − lucro realizado − lucro flutuante`), não o custo da posição
 * atual — assim a série termina exatamente em `valor atual + proventos` mesmo
 * quando há lucro realizado.
 *
 * Cada ponto traz `base` (deslocamento invisível) e `valor` (altura da barra)
 * para o efeito cascata no gráfico.
 */
export function serieDecomposicaoRetorno(detalhe: DetalheAtivo): PontoDecomposicao[] {
  const pontos: PontoDecomposicao[] = []
  let acumulado = 0

  const adicionar = (rotulo: string, valor: number) => {
    const base = valor >= 0 ? acumulado : acumulado + valor
    acumulado = round2(acumulado + valor)
    pontos.push({ rotulo, valor, base, acumulado })
  }

  // Capital líquido aportado: garante que a série termine em `valor atual + proventos`.
  const valorInvestido = round2(
    detalhe.valorAtual - detalhe.lucroRealizado - detalhe.lucroFlutuante,
  )

  adicionar('Valor investido', valorInvestido)
  adicionar('Lucro realizado', detalhe.lucroRealizado)
  adicionar('Variação', detalhe.lucroFlutuante)
  adicionar('Proventos', detalhe.proventosNoPeriodo)

  const patrimonioFinal = acumulado
  pontos.push({
    rotulo: 'Patrimônio final',
    valor: patrimonioFinal,
    base: 0,
    acumulado: patrimonioFinal,
  })

  return pontos
}

/**
 * Proventos por mês (`YYYY-MM`) do ticker, restritos à janela 1ª compra →
 * data de referência (hoje), ordenados do mais antigo para o mais recente.
 */
export function serieProventosPorMes(
  proventos: readonly Provento[],
  ticker: string,
  dataInicio: string | null,
  dataFim: string | null,
): AgregadoProvento[] {
  const filtrados = filtrarProventosDoTicker(ticker, proventos, dataInicio, dataFim)
  const mapa = new Map<string, number>()
  for (const provento of filtrados) {
    const mes = provento.dataPagamento.slice(0, 7)
    if (mes.length !== 7) continue
    mapa.set(mes, (mapa.get(mes) ?? 0) + provento.valorTotal)
  }

  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, valorTotal]) => ({
      chave: mes,
      rotulo: formatarMesAnoBR(mes),
      valorTotal: round2(valorTotal),
    }))
}
