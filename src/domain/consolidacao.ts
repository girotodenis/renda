import { calcularFluxoRealizado } from '@/domain/detalheAtivo'
import { calcularPosicoes } from '@/domain/consolidado'
import { fatorQuantidade, isTipoEventoCorporativo } from '@/domain/eventosCorporativos'
import { round2 } from '@/domain/money'
import { OperacaoTipo } from '@/domain/entities'
import type { CategoriaAtivo, Operacao, Provento, ProventoTipo } from '@/domain/entities'

/**
 * Consolidação do histórico por ticker/ano (`PLANO_CONSOLIDACAO.md`) — módulo
 * **puro** e testável.
 *
 * Substitui N operações de um ticker encerrado por **1 compra + 1 venda** e N
 * proventos por **1 linha por tipo/ano**, preservando exatamente: posição,
 * preço médio, total investido, lucro realizado e totais de proventos. Nenhuma
 * aba, coluna ou estado novo é criado: o resultado é derivado das próprias abas
 * `Operacoes` e `Proventos`.
 *
 * Convenções: dinheiro em **centavos inteiros**; datas ISO `YYYY-MM-DD`;
 * arredondamento com `round2`. Não há dependência de UI/rede.
 */

/** Diferença aceita ao comparar quantidades/custos por ponto flutuante. */
const EPS = 1e-6

/** Modo de consolidação de um ano de ticker com posição aberta. */
export type ModoConsolidacao = 'Completo' | 'SomenteProventos'

/** Ano elegível de um ticker com posição aberta (escopo por ano). */
export interface AnoPendente {
  ano: number
  modo: ModoConsolidacao
  /** Operações que seriam absorvidas (0 quando só há proventos a agregar). */
  operacoesParaAbsorver: number
  /** Proventos que seriam absorvidos. */
  proventosParaAbsorver: number
  /** Motivo de bloqueio do ano — `null` quando pode consolidar. */
  impedimento: string | null
}

/** Item da página Consolidação: um ticker encerrado ou um ticker com anos elegíveis. */
export interface PendenciaConsolidacao {
  ticker: string
  categoria: CategoriaAtivo
  estado: 'encerrado' | 'ativo'
  /** Operações que seriam absorvidas (0 quando só há proventos a agregar). */
  operacoesParaAbsorver: number
  /** Proventos que seriam absorvidos. */
  proventosParaAbsorver: number
  primeiraCompra: string | null
  ultimaVenda: string | null
  totalCompras: number
  totalVendas: number
  totalProventos: number
  lucroRealizado: number
  /** Anos elegíveis (< ano corrente) com pendência, para tickers ativos. */
  anos: AnoPendente[]
  /** Motivo de bloqueio (histórico inconsistente) — `null` quando pode consolidar. */
  impedimento: string | null
}

/** Escopo escolhido pelo usuário na página Consolidação. */
export type AlvoConsolidacao =
  | { tipo: 'ticker'; ticker: string }
  | { tipo: 'ticker-ano'; ticker: string; ano: number; modo: ModoConsolidacao }

/** Totais resultantes do escopo consolidado (em centavos). */
export interface ResumoConsolidacao {
  totalCompras: number
  totalVendas: number
  totalProventos: number
  /**
   * Lucro realizado do escopo: do ticker inteiro (escopo `ticker`), do ano
   * (`Completo`) ou `0` quando as operações do ano não foram consolidadas.
   */
  lucroRealizado: number
}

/** Resultado do cálculo de uma consolidação (listas finais prontas para gravar). */
export interface ResultadoConsolidacaoCalculada {
  /** Lista final da aba `Operacoes` (linhas mantidas + consolidadas). */
  operacoes: Operacao[]
  /** Lista final da aba `Proventos` (linhas mantidas + consolidadas). */
  proventos: Provento[]
  absorvidas: { operacoes: Operacao[]; proventos: Provento[] }
  geradas: { operacoes: Operacao[]; proventos: Provento[] }
  resumo: ResumoConsolidacao
}

/** Divergência encontrada na verificação de invariantes (bloqueia a gravação). */
export interface Divergencia {
  metrica: string
  esperado: number
  obtido: number
}

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** `true` quando a data é um ISO `YYYY-MM-DD` com dia/mês existentes. */
export function isDataIsoValida(data: string | null | undefined): data is string {
  if (typeof data !== 'string') return false
  const partes = DATA_ISO.exec(data.trim())
  if (!partes) return false
  const ano = Number(partes[1])
  const mes = Number(partes[2])
  const dia = Number(partes[3])
  if (mes < 1 || mes > 12 || dia < 1) return false
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0)
  const ultimoDia = mes === 2 && bissexto ? 29 : DIAS_POR_MES[mes - 1]
  return dia <= ultimoDia
}

function normalizarTicker(ticker: string): string {
  return ticker.trim()
}

function anoDaData(data: string): number | null {
  if (!isDataIsoValida(data)) return null
  return Number(data.slice(0, 4))
}

function anoDoProvento(provento: Provento): number | null {
  return isDataIsoValida(provento.dataPagamento)
    ? Number(provento.dataPagamento.slice(0, 4))
    : null
}

function ordenarOperacoes(operacoes: readonly Operacao[]): Operacao[] {
  return [...operacoes].sort(
    (a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id),
  )
}

function operacoesDoTicker(ticker: string, operacoes: readonly Operacao[]): Operacao[] {
  return operacoes.filter((operacao) => normalizarTicker(operacao.ticker) === ticker)
}

function proventosDoTicker(ticker: string, proventos: readonly Provento[]): Provento[] {
  return proventos.filter((provento) => normalizarTicker(provento.ticker) === ticker)
}

/**
 * Grupos de proventos por `(ano da dataPagamento, tipo)`, ignorando linhas com
 * `dataPagamento` inválida (ficam fora da consolidação).
 */
function gruposDeProventos(proventos: readonly Provento[]): Map<string, Provento[]> {
  const grupos = new Map<string, Provento[]>()
  for (const provento of proventos) {
    const ano = anoDoProvento(provento)
    if (ano === null) continue
    const chave = `${ano}|${provento.tipo}`
    const lista = grupos.get(chave)
    if (lista) lista.push(provento)
    else grupos.set(chave, [provento])
  }
  return grupos
}

/** Proventos que seriam absorvidos (linhas em grupos `(ano, tipo)` com ≥ 2). */
function contarProventosAbsorviveis(proventos: readonly Provento[]): number {
  let total = 0
  for (const linhas of gruposDeProventos(proventos).values()) {
    if (linhas.length >= 2) total += linhas.length
  }
  return total
}

/** Proventos com `dataPagamento` inválida (não entram na consolidação). */
export function contarProventosComDataInvalida(proventos: readonly Provento[]): number {
  return proventos.filter((provento) => !isDataIsoValida(provento.dataPagamento)).length
}

/** `true` quando há ≥ 2 movimentos ou algum evento corporativo a absorver. */
function precisaConsolidarOperacoes(operacoes: readonly Operacao[]): boolean {
  let movimentos = 0
  for (const operacao of operacoes) {
    if (isTipoEventoCorporativo(operacao.tipo)) return true
    if (operacao.tipo === OperacaoTipo.Compra || operacao.tipo === OperacaoTipo.Venda) {
      movimentos += 1
    }
  }
  return movimentos > 2
}

/**
 * Critério objetivo de "ainda há o que consolidar" (§2.1): só existe pendência
 * quando há grupo com 2+ linhas. Depois de consolidar, o item deixa de
 * satisfazer o critério e desaparece da lista — idempotência sem estado extra.
 */
export function precisaConsolidar(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
): { operacoes: boolean; proventos: boolean } {
  return {
    operacoes: precisaConsolidarOperacoes(operacoes),
    proventos: contarProventosAbsorviveis(proventos) > 0,
  }
}

interface ResumoOperacoes {
  primeiraCompra: string | null
  ultimaVenda: string | null
  totalCompras: number
  totalVendas: number
}

function resumirOperacoes(operacoes: readonly Operacao[]): ResumoOperacoes {
  let primeiraCompra: string | null = null
  let ultimaVenda: string | null = null
  let totalCompras = 0
  let totalVendas = 0

  for (const operacao of operacoes) {
    if (operacao.tipo === OperacaoTipo.Compra) {
      totalCompras += operacao.quantidade * operacao.precoUnitario + operacao.taxas
      if (primeiraCompra === null || operacao.data < primeiraCompra) {
        primeiraCompra = operacao.data
      }
    } else if (operacao.tipo === OperacaoTipo.Venda) {
      totalVendas += operacao.quantidade * operacao.precoUnitario
      if (ultimaVenda === null || operacao.data > ultimaVenda) {
        ultimaVenda = operacao.data
      }
    }
  }

  return {
    primeiraCompra,
    ultimaVenda,
    totalCompras: round2(totalCompras),
    totalVendas: round2(totalVendas),
  }
}

/** Quantidade da posição no fim de cada ano com operações (mapa `ano → quantidade`). */
function quantidadesPorAno(ordenadas: readonly Operacao[]): Map<number, number> {
  const mapa = new Map<number, number>()
  let quantidade = 0
  let anoAtual: number | null = null

  for (const operacao of ordenadas) {
    const ano = anoDaData(operacao.data)
    if (ano !== null) {
      if (anoAtual !== null && ano !== anoAtual) mapa.set(anoAtual, round2(quantidade))
      anoAtual = ano
    }

    if (isTipoEventoCorporativo(operacao.tipo)) {
      quantidade = round2(quantidade * fatorQuantidade(operacao.tipo, operacao.quantidade))
    } else if (operacao.tipo === OperacaoTipo.Venda) {
      quantidade = round2(quantidade - operacao.quantidade)
    } else {
      quantidade = round2(quantidade + operacao.quantidade)
    }
  }

  if (anoAtual !== null) mapa.set(anoAtual, round2(quantidade))
  return mapa
}

/** Quantidade no fim do ano `alvo` (o último ano com operação ≤ `alvo`, ou 0). */
function quantidadeNoFimDoAno(mapa: ReadonlyMap<number, number>, alvo: number): number {
  let melhorAno: number | null = null
  let quantidade = 0
  for (const [ano, valor] of mapa) {
    if (ano <= alvo && (melhorAno === null || ano > melhorAno)) {
      melhorAno = ano
      quantidade = valor
    }
  }
  return quantidade
}

/** Identifica o primeiro problema de um histórico (posição ou custo negativos). */
function validarHistorico(ordenadas: readonly Operacao[], rotulo: string): string | null {
  let quantidade = 0
  let custo = 0

  for (const operacao of ordenadas) {
    if (isTipoEventoCorporativo(operacao.tipo)) {
      quantidade = round2(quantidade * fatorQuantidade(operacao.tipo, operacao.quantidade))
    } else if (operacao.tipo === OperacaoTipo.Venda) {
      const custoMedio = quantidade === 0 ? 0 : custo / quantidade
      custo -= operacao.quantidade * custoMedio
      quantidade = round2(quantidade - operacao.quantidade)
    } else {
      custo += operacao.quantidade * operacao.precoUnitario + operacao.taxas
      quantidade = round2(quantidade + operacao.quantidade)
    }

    if (quantidade < -EPS) {
      return `Histórico de ${rotulo} tem venda sem posição; ajuste as operações antes de consolidar.`
    }
    if (custo < -EPS) {
      return `Histórico de ${rotulo} tem custo negativo; ajuste as operações antes de consolidar.`
    }
  }

  return null
}

/** Divisão inteira com resíduo em `[0, quantidade)`. */
function dividir(total: number, quantidade: number): { preco: number; residuo: number } {
  const preco = Math.floor(total / quantidade + 1e-9)
  const residuo = round2(total - preco * quantidade)
  if (residuo >= quantidade) return { preco: preco + 1, residuo: round2(residuo - quantidade) }
  if (residuo < 0) return { preco: preco - 1, residuo: round2(residuo + quantidade) }
  return { preco, residuo }
}

interface AritmeticaConsolidacao {
  quantidadeCompra: number
  quantidadeVenda: number
  custoCompras: number
  receitaVendas: number
  precoCompra: number
  taxasCompra: number
  precoVenda: number
}

/**
 * Aritmética exata da consolidação (§3.2): devolve as duas linhas que preservam
 * o lucro realizado (`P − C`) e fecham a posição em zero.
 *
 * Cada compra/venda é convertida para as **unidades finais** pelo produto dos
 * fatores de quantidade dos eventos posteriores (eventos depois da última
 * movimentação atuam sobre posição zero e não entram na escala). O resíduo
 * `r = P mod Q` é retirado dos dois lados — da receita (preço da venda) e do
 * custo (taxas da compra) — de modo que `lucro = (P − r) − (C − r) = P − C`.
 */
function calcularAritmetica(
  ordenadas: readonly Operacao[],
  rotulo: string,
): AritmeticaConsolidacao | { erro: string } {
  const impedimento = validarHistorico(ordenadas, rotulo)
  if (impedimento) return { erro: impedimento }

  // Fatores residuais: percorre de trás para frente acumulando os eventos.
  let ultimaMovimentacao = -1
  for (let indice = ordenadas.length - 1; indice >= 0; indice -= 1) {
    const tipo = ordenadas[indice].tipo
    if (tipo === OperacaoTipo.Compra || tipo === OperacaoTipo.Venda) {
      ultimaMovimentacao = indice
      break
    }
  }
  if (ultimaMovimentacao < 0) return { erro: `Não há compras ou vendas em ${rotulo}.` }

  const fatores = new Map<number, number>()
  let fator = 1
  for (let indice = ultimaMovimentacao; indice >= 0; indice -= 1) {
    const operacao = ordenadas[indice]
    if (isTipoEventoCorporativo(operacao.tipo)) {
      fator *= fatorQuantidade(operacao.tipo, operacao.quantidade)
      continue
    }
    fatores.set(indice, fator)
  }

  let quantidadeCompra = 0
  let quantidadeVenda = 0
  let custoCompras = 0
  let receitaVendas = 0

  for (let indice = 0; indice <= ultimaMovimentacao; indice += 1) {
    const operacao = ordenadas[indice]
    if (isTipoEventoCorporativo(operacao.tipo)) continue
    const fatorResidual = fatores.get(indice) ?? 1
    if (operacao.tipo === OperacaoTipo.Venda) {
      quantidadeVenda += operacao.quantidade * fatorResidual
      receitaVendas += operacao.quantidade * operacao.precoUnitario
    } else {
      quantidadeCompra += operacao.quantidade * fatorResidual
      custoCompras += operacao.quantidade * operacao.precoUnitario + operacao.taxas
    }
  }

  const quantidade = round2(quantidadeCompra)
  const quantidadeVendas = round2(quantidadeVenda)

  if (quantidade === 0) {
    return {
      erro: `As operações de ${rotulo} não fecham em quantidade zero (eventos corporativos?). Ajuste os eventos antes de consolidar.`,
    }
  }
  if (Math.abs(quantidade - quantidadeVendas) > EPS) {
    return {
      erro: `As operações de ${rotulo} não fecham em quantidade zero (eventos corporativos?). Ajuste os eventos antes de consolidar.`,
    }
  }

  const venda = dividir(receitaVendas, quantidade)
  const custoCompra = round2(custoCompras - venda.residuo)
  if (custoCompra < -EPS) {
    return {
      erro: `O custo de compra de ${rotulo} é insuficiente para o resíduo de arredondamento; ajuste os valores antes de consolidar.`,
    }
  }
  const compra = dividir(custoCompra, quantidade)
  if (compra.preco < 0) {
    return {
      erro: `O custo de compra de ${rotulo} é insuficiente para o resíduo de arredondamento; ajuste os valores antes de consolidar.`,
    }
  }

  return {
    quantidadeCompra: quantidade,
    quantidadeVenda: quantidadeVendas,
    custoCompras: custoCompra,
    receitaVendas: round2(receitaVendas - venda.residuo),
    precoCompra: compra.preco,
    taxasCompra: compra.residuo,
    precoVenda: venda.preco,
  }
}

function operacaoMaisRecente(ordenadas: readonly Operacao[]): Operacao {
  let recente = ordenadas[0]
  for (const operacao of ordenadas) {
    if (
      operacao.data > recente.data ||
      (operacao.data === recente.data && operacao.id > recente.id)
    ) {
      recente = operacao
    }
  }
  return recente
}

/**
 * Substitui, preservando a ordem original, as linhas absorvidas pelas geradas
 * (as geradas entram na posição da primeira linha absorvida).
 */
function substituir<T extends { id: string }>(
  lista: readonly T[],
  absorvidas: readonly T[],
  geradas: readonly T[],
): T[] {
  if (absorvidas.length === 0) return [...lista]
  const ids = new Set(absorvidas.map((item) => item.id))
  const resultado: T[] = []
  let inserido = false

  for (const item of lista) {
    if (!ids.has(item.id)) {
      resultado.push(item)
      continue
    }
    if (!inserido) {
      resultado.push(...geradas)
      inserido = true
    }
  }
  if (!inserido) resultado.push(...geradas)
  return resultado
}

function calcularResumo(
  operacoesFinais: readonly Operacao[],
  proventosFinais: readonly Provento[],
  ticker: string,
  alvo: AlvoConsolidacao,
): ResumoConsolidacao {
  const noEscopo = (operacao: Operacao): boolean => {
    if (normalizarTicker(operacao.ticker) !== ticker) return false
    if (alvo.tipo === 'ticker') return true
    return anoDaData(operacao.data) === alvo.ano
  }
  const proventoNoEscopo = (provento: Provento): boolean => {
    if (normalizarTicker(provento.ticker) !== ticker) return false
    if (alvo.tipo === 'ticker') return true
    return anoDoProvento(provento) === alvo.ano
  }

  let totalCompras = 0
  let totalVendas = 0
  for (const operacao of operacoesFinais) {
    if (!noEscopo(operacao)) continue
    if (operacao.tipo === OperacaoTipo.Compra) {
      totalCompras += operacao.quantidade * operacao.precoUnitario + operacao.taxas
    } else if (operacao.tipo === OperacaoTipo.Venda) {
      totalVendas += operacao.quantidade * operacao.precoUnitario
    }
  }

  const totalProventos = proventosFinais
    .filter(proventoNoEscopo)
    .reduce((soma, provento) => soma + provento.valorTotal, 0)

  // Ticker encerrado: o lucro realizado do ticker inteiro. Ano `Completo`: como
  // o ano começa e termina zerado, `vendas − compras` é exatamente o lucro do
  // ano. Ano `SomenteProventos`: as operações não são tocadas (lucro 0).
  const lucroRealizado =
    alvo.tipo === 'ticker'
      ? calcularFluxoRealizado(ticker, operacoesFinais).lucroRealizado
      : alvo.modo === 'Completo'
        ? round2(totalVendas - totalCompras)
        : 0

  return {
    totalCompras: round2(totalCompras),
    totalVendas: round2(totalVendas),
    totalProventos: round2(totalProventos),
    lucroRealizado,
  }
}

/**
 * Calcula uma consolidação para o escopo escolhido (§3.2–§3.6).
 *
 * Devolve as listas finais prontas para gravar ou `{ erro }` quando o histórico
 * é inconsistente (venda a descoberto, quantidades que não fecham em zero, ano
 * não auto-contido).
 *
 * - Ticker encerrado: consolida operações (quando há ganho) + proventos.
 * - Ticker ativo por ano `Completo`: consolida as operações do ano + proventos.
 * - Ticker ativo por ano `SomenteProventos`: só consolida os proventos.
 */
export function calcularConsolidacao(
  alvo: AlvoConsolidacao,
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  opcoes: { novoId: () => string },
): ResultadoConsolidacaoCalculada | { erro: string } {
  const ticker = normalizarTicker(alvo.ticker)
  if (ticker.length === 0) return { erro: 'Informe o ticker a consolidar.' }

  const doTicker = operacoesDoTicker(ticker, operacoes)
  if (doTicker.length === 0) return { erro: `Não há operações lançadas para ${ticker}.` }

  const ordenadas = ordenarOperacoes(doTicker)
  const provsTicker = proventosDoTicker(ticker, proventos)
  const rotulo = alvo.tipo === 'ticker' ? ticker : `${ticker} em ${alvo.ano}`

  const escopoOps =
    alvo.tipo === 'ticker'
      ? ordenadas
      : ordenadas.filter((operacao) => anoDaData(operacao.data) === alvo.ano)
  const escopoProv =
    alvo.tipo === 'ticker'
      ? provsTicker
      : provsTicker.filter((provento) => anoDoProvento(provento) === alvo.ano)

  const absorvidasOps: Operacao[] = []
  const geradasOps: Operacao[] = []

  const consolidaOperacoes = alvo.tipo === 'ticker' || alvo.modo === 'Completo'

  if (alvo.tipo === 'ticker-ano' && alvo.modo === 'Completo') {
    const mapa = quantidadesPorAno(ordenadas)
    const inicio = quantidadeNoFimDoAno(mapa, alvo.ano - 1)
    const fim = quantidadeNoFimDoAno(mapa, alvo.ano)
    if (Math.abs(inicio) > EPS || Math.abs(fim) > EPS) {
      return {
        erro: `O ano ${alvo.ano} de ${ticker} tem posição em aberto; use o modo "Somente proventos".`,
      }
    }
  }

  if (consolidaOperacoes && precisaConsolidarOperacoes(escopoOps)) {
    const aritmetica = calcularAritmetica(escopoOps, rotulo)
    if ('erro' in aritmetica) return aritmetica

    const recente = operacaoMaisRecente(escopoOps)
    const resumoOps = resumirOperacoes(escopoOps)

    const compra: Operacao = {
      id: opcoes.novoId(),
      data: resumoOps.primeiraCompra ?? recente.data,
      tipo: OperacaoTipo.Compra,
      categoria: recente.categoria,
      ticker,
      quantidade: aritmetica.quantidadeCompra,
      precoUnitario: aritmetica.precoCompra,
      taxas: aritmetica.taxasCompra,
      indexador: null,
      percentualIndexador: null,
      vencimento: null,
      valorBrutoAtual: null,
    }
    const venda: Operacao = {
      id: opcoes.novoId(),
      data: resumoOps.ultimaVenda ?? recente.data,
      tipo: OperacaoTipo.Venda,
      categoria: recente.categoria,
      ticker,
      quantidade: aritmetica.quantidadeVenda,
      precoUnitario: aritmetica.precoVenda,
      taxas: 0,
      indexador: null,
      percentualIndexador: null,
      vencimento: null,
      valorBrutoAtual: null,
    }

    // Metadados de marcação manual/RF vão para a linha de **maior data** — é de
    // lá que `precosBrutosMaisRecentes` lê o preço e a marcação atual.
    const linhaRecente = venda.data >= compra.data ? venda : compra
    linhaRecente.indexador = recente.indexador
    linhaRecente.percentualIndexador = recente.percentualIndexador
    linhaRecente.vencimento = recente.vencimento
    linhaRecente.valorBrutoAtual = recente.valorBrutoAtual

    absorvidasOps.push(...escopoOps)
    geradasOps.push(compra, venda)
  }

  const absorvidosProv: Provento[] = []
  const geradosProv: Provento[] = []

  for (const linhas of gruposDeProventos(escopoProv).values()) {
    if (linhas.length < 2) continue
    const ordenadasGrupo = [...linhas].sort(
      (a, b) => a.dataPagamento.localeCompare(b.dataPagamento) || a.id.localeCompare(b.id),
    )
    const ultima = ordenadasGrupo[ordenadasGrupo.length - 1]
    absorvidosProv.push(...linhas)
    geradosProv.push({
      id: opcoes.novoId(),
      dataCom: null,
      dataPagamento: ultima.dataPagamento,
      categoria: ultima.categoria,
      ticker,
      tipo: linhas[0].tipo as ProventoTipo,
      valorTotal: round2(linhas.reduce((soma, provento) => soma + provento.valorTotal, 0)),
    })
  }

  const operacoesFinais = substituir(operacoes, absorvidasOps, geradasOps)
  const proventosFinais = substituir(proventos, absorvidosProv, geradosProv)

  return {
    operacoes: operacoesFinais,
    proventos: proventosFinais,
    absorvidas: { operacoes: absorvidasOps, proventos: absorvidosProv },
    geradas: { operacoes: geradasOps, proventos: geradosProv },
    resumo: calcularResumo(operacoesFinais, proventosFinais, ticker, alvo),
  }
}

function comparar(
  divergencias: Divergencia[],
  metrica: string,
  esperado: number,
  obtido: number,
  tolerancia = 0,
): void {
  if (Math.abs(esperado - obtido) > tolerancia + EPS) {
    divergencias.push({ metrica, esperado: round2(esperado), obtido: round2(obtido) })
  }
}

function somarPorTicker(
  operacoes: readonly Operacao[],
  tipo: OperacaoTipo,
): Map<string, number> {
  const totais = new Map<string, number>()
  for (const operacao of operacoes) {
    if (operacao.tipo !== tipo) continue
    const ticker = normalizarTicker(operacao.ticker)
    if (ticker.length === 0) continue
    const valor =
      tipo === OperacaoTipo.Compra
        ? operacao.quantidade * operacao.precoUnitario + operacao.taxas
        : operacao.quantidade * operacao.precoUnitario
    totais.set(ticker, (totais.get(ticker) ?? 0) + valor)
  }
  return totais
}

function agruparValoresDeProventos(proventos: readonly Provento[]): Map<string, number> {
  const totais = new Map<string, number>()
  for (const provento of proventos) {
    const ticker = normalizarTicker(provento.ticker)
    if (ticker.length === 0) continue
    const chave = `${ticker}|${provento.dataPagamento.slice(0, 4)}|${provento.tipo}`
    totais.set(chave, (totais.get(chave) ?? 0) + provento.valorTotal)
  }
  return totais
}

/**
 * Verificação de invariantes obrigatória antes de gravar (§3.5).
 *
 * Compara o estado antes/depois e devolve as divergências (lista vazia quando
 * tudo se preserva): quantidade, total investido e preço médio por ticker,
 * lucro realizado por ticker e Σ proventos por `(ticker, ano, tipo)` — todos com
 * tolerância **zero**. O custo das compras e a receita das vendas admitem
 * apenas o resíduo de arredondamento das linhas consolidadas (limitado pela
 * quantidade dessas linhas, pois `r < Q`).
 */
export function verificarInvariantes(
  antes: { operacoes: readonly Operacao[]; proventos: readonly Provento[] },
  depois: { operacoes: readonly Operacao[]; proventos: readonly Provento[] },
): Divergencia[] {
  const divergencias: Divergencia[] = []
  const idsAntes = new Set(antes.operacoes.map((operacao) => operacao.id))
  const geradas = depois.operacoes.filter((operacao) => !idsAntes.has(operacao.id))

  const posicoesAntes = new Map(
    calcularPosicoes(antes.operacoes).map((posicao) => [posicao.ticker, posicao]),
  )
  const posicoesDepois = new Map(
    calcularPosicoes(depois.operacoes).map((posicao) => [posicao.ticker, posicao]),
  )
  const tickers = new Set([...posicoesAntes.keys(), ...posicoesDepois.keys()])

  for (const ticker of tickers) {
    const posicaoAntes = posicoesAntes.get(ticker)
    const posicaoDepois = posicoesDepois.get(ticker)
    comparar(
      divergencias,
      `Quantidade de ${ticker}`,
      posicaoAntes?.quantidadeAtual ?? 0,
      posicaoDepois?.quantidadeAtual ?? 0,
    )
    comparar(
      divergencias,
      `Total investido de ${ticker}`,
      posicaoAntes?.totalInvestido ?? 0,
      posicaoDepois?.totalInvestido ?? 0,
    )
    comparar(
      divergencias,
      `Preço médio de ${ticker}`,
      posicaoAntes?.precoMedio ?? 0,
      posicaoDepois?.precoMedio ?? 0,
    )
    comparar(
      divergencias,
      `Lucro realizado de ${ticker}`,
      calcularFluxoRealizado(ticker, antes.operacoes).lucroRealizado,
      calcularFluxoRealizado(ticker, depois.operacoes).lucroRealizado,
    )
  }

  const proventosAntes = agruparValoresDeProventos(antes.proventos)
  const proventosDepois = agruparValoresDeProventos(depois.proventos)
  const chavesProventos = new Set([...proventosAntes.keys(), ...proventosDepois.keys()])
  for (const chave of chavesProventos) {
    comparar(
      divergencias,
      `Proventos ${chave.replaceAll('|', '/')}`,
      proventosAntes.get(chave) ?? 0,
      proventosDepois.get(chave) ?? 0,
    )
  }

  // Totais por ticker: a única diferença aceita é o resíduo de arredondamento
  // (`r < Q`), limitado pela quantidade das linhas consolidadas geradas.
  const toleranciaDe = (ticker: string, tipo: OperacaoTipo): number =>
    round2(
      geradas
        .filter(
          (operacao) =>
            operacao.tipo === tipo && normalizarTicker(operacao.ticker) === ticker,
        )
        .reduce((soma, operacao) => soma + operacao.quantidade, 0),
    )

  const comprasAntes = somarPorTicker(antes.operacoes, OperacaoTipo.Compra)
  const comprasDepois = somarPorTicker(depois.operacoes, OperacaoTipo.Compra)
  const vendasAntes = somarPorTicker(antes.operacoes, OperacaoTipo.Venda)
  const vendasDepois = somarPorTicker(depois.operacoes, OperacaoTipo.Venda)
  const tickersTotais = new Set([
    ...comprasAntes.keys(),
    ...comprasDepois.keys(),
    ...vendasAntes.keys(),
    ...vendasDepois.keys(),
  ])

  for (const ticker of tickersTotais) {
    comparar(
      divergencias,
      `Custo das compras de ${ticker}`,
      comprasAntes.get(ticker) ?? 0,
      comprasDepois.get(ticker) ?? 0,
      toleranciaDe(ticker, OperacaoTipo.Compra),
    )
    comparar(
      divergencias,
      `Receita das vendas de ${ticker}`,
      vendasAntes.get(ticker) ?? 0,
      vendasDepois.get(ticker) ?? 0,
      toleranciaDe(ticker, OperacaoTipo.Venda),
    )
  }

  return divergencias
}

/**
 * Pré-validação de um escopo de operações: histórico inválido (venda a
 * descoberto, custo negativo) ou quantidades que não fecham em zero.
 */
function impedimentoDasOperacoes(
  ordenadas: readonly Operacao[],
  rotulo: string,
): string | null {
  const aritmetica = calcularAritmetica(ordenadas, rotulo)
  return 'erro' in aritmetica ? aritmetica.erro : null
}

/**
 * Analisa as pendências de consolidação (§3.1) — alimenta a página.
 *
 * Tickers **encerrados** (posição 0 com compra e venda) entram com escopo do
 * ticker inteiro; tickers **ativos** entram com os anos elegíveis anteriores ao
 * ano corrente (`Completo` quando o ano é auto-contido; `SomenteProventos`
 * quando a posição fica aberta no ano). Históricos inconsistentes trazem o
 * `impedimento` e ficam com o botão desabilitado na UI.
 */
export function analisarPendencias(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  anoCorrente: number,
): PendenciaConsolidacao[] {
  const porTicker = new Map<string, Operacao[]>()
  for (const operacao of operacoes) {
    const ticker = normalizarTicker(operacao.ticker)
    if (ticker.length === 0) continue
    const lista = porTicker.get(ticker)
    if (lista) lista.push(operacao)
    else porTicker.set(ticker, [operacao])
  }

  const pendencias: PendenciaConsolidacao[] = []

  for (const [ticker, doTicker] of porTicker) {
    const ordenadas = ordenarOperacoes(doTicker)
    const posicao = calcularPosicoes(doTicker).find((item) => item.ticker === ticker)
    if (!posicao) continue

    const resumo = resumirOperacoes(doTicker)
    const provsTicker = proventosDoTicker(ticker, proventos)
    const provsValidos = provsTicker.filter((provento) =>
      isDataIsoValida(provento.dataPagamento),
    )
    const totalProventos = round2(
      provsValidos.reduce((soma, provento) => soma + provento.valorTotal, 0),
    )
    const temCompra = doTicker.some((operacao) => operacao.tipo === OperacaoTipo.Compra)
    const temVenda = doTicker.some((operacao) => operacao.tipo === OperacaoTipo.Venda)
    const encerrado = posicao.quantidadeAtual === 0 && temCompra && temVenda
    const base = {
      ticker,
      categoria: posicao.categoria,
      primeiraCompra: resumo.primeiraCompra,
      ultimaVenda: resumo.ultimaVenda,
      totalCompras: resumo.totalCompras,
      totalVendas: resumo.totalVendas,
      totalProventos,
      lucroRealizado: calcularFluxoRealizado(ticker, doTicker).lucroRealizado,
    }

    if (encerrado) {
      const criterio = precisaConsolidar(doTicker, provsTicker)
      if (!criterio.operacoes && !criterio.proventos) continue

      pendencias.push({
        ...base,
        estado: 'encerrado',
        operacoesParaAbsorver: criterio.operacoes ? doTicker.length : 0,
        proventosParaAbsorver: criterio.proventos
          ? contarProventosAbsorviveis(provsTicker)
          : 0,
        anos: [],
        impedimento: criterio.operacoes ? impedimentoDasOperacoes(ordenadas, ticker) : null,
      })
      continue
    }

    const mapaQuantidades = quantidadesPorAno(ordenadas)
    const anosCandidatos = new Set<number>()
    for (const operacao of ordenadas) {
      const ano = anoDaData(operacao.data)
      if (ano !== null && ano < anoCorrente) anosCandidatos.add(ano)
    }
    for (const provento of provsValidos) {
      const ano = anoDoProvento(provento)
      if (ano !== null && ano < anoCorrente) anosCandidatos.add(ano)
    }

    const anos: AnoPendente[] = []
    for (const ano of [...anosCandidatos].sort((a, b) => a - b)) {
      const opsDoAno = ordenadas.filter((operacao) => anoDaData(operacao.data) === ano)
      const provsDoAno = provsValidos.filter(
        (provento) => anoDoProvento(provento) === ano,
      )
      const inicio = quantidadeNoFimDoAno(mapaQuantidades, ano - 1)
      const fim = quantidadeNoFimDoAno(mapaQuantidades, ano)
      const autoContido = Math.abs(inicio) < EPS && Math.abs(fim) < EPS
      const modo: ModoConsolidacao = autoContido ? 'Completo' : 'SomenteProventos'
      const precisaOps = autoContido && precisaConsolidarOperacoes(opsDoAno)
      const proventosParaAbsorver = contarProventosAbsorviveis(provsDoAno)

      if (!precisaOps && proventosParaAbsorver === 0) continue

      anos.push({
        ano,
        modo,
        operacoesParaAbsorver: precisaOps ? opsDoAno.length : 0,
        proventosParaAbsorver,
        impedimento: precisaOps
          ? impedimentoDasOperacoes(opsDoAno, `${ticker} em ${ano}`)
          : null,
      })
    }

    if (anos.length === 0) continue

    pendencias.push({
      ...base,
      estado: 'ativo',
      operacoesParaAbsorver: anos.reduce((soma, ano) => soma + ano.operacoesParaAbsorver, 0),
      proventosParaAbsorver: anos.reduce((soma, ano) => soma + ano.proventosParaAbsorver, 0),
      anos,
      impedimento: null,
    })
  }

  // Ordenação determinística: encerrados primeiro (por ticker), depois ativos.
  return pendencias.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === 'encerrado' ? -1 : 1
    return a.ticker.localeCompare(b.ticker)
  })
}
