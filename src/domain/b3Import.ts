import { parseCsv } from '@/lib/csv'
import { parseDecimalBR, toCentavos } from '@/lib/money'
import { CategoriaAtivo, OperacaoTipo, ProventoTipo } from '@/types/domain'
import type { Operacao, Provento } from '@/types/domain'

/**
 * Análise/classificação dos extratos CSV exportados pela B3 (Área do
 * Investidor) — RF23 (importação por arquivo, Etapa 8).
 *
 * Dois formatos são suportados (detecção pelo cabeçalho):
 * - `movimentacao`: `Entrada/Saída,Data,Movimentação,Produto,Instituição,...`
 * - `proventos`: `Produto,Pagamento,Tipo de Evento,Instituição,...`
 *
 * Regras (ver skill `integracao-b3`):
 * - Proventos (Dividendo, JCP, Rendimento) viram `Provento`.
 * - "Transferência - Liquidação" vira `Operacao` (Crédito → Compra, Débito → Venda).
 * - Demais movimentações (transferências, empréstimo, direitos, reembolso) são
 *   **ignoradas** e reportadas (não mapeiam para o modelo atual).
 * - IDs são **determinísticos** (hash do registro) para permitir deduplicação
 *   na reimportação sem coluna extra na v1.
 *
 * Tudo aqui é **puro** (sem rede/UI) e testável.
 */

export type B3Formato = 'movimentacao' | 'proventos'

/** Linha do extrato que não pôde ser importada, com o motivo. */
export interface B3LinhaIgnorada {
  /** Número da linha no arquivo (1-based, incluindo o cabeçalho). */
  linha: number
  produto: string
  movimentacao: string
  motivo: string
}

/** Resultado da análise de um (ou mais) arquivos B3. */
export interface B3ParseResult {
  formato: B3Formato | null
  proventos: Provento[]
  operacoes: Operacao[]
  ignorados: B3LinhaIgnorada[]
  /** Quantidade de linhas de dados (excluindo o cabeçalho). */
  totalLinhas: number
}

function normalizar(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function dataBRParaISO(texto: string): string | null {
  const t = texto.trim()
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

/** Extrai o ticker de `"B1AM34 - BROOKFIELD ASSET MANAGEMENT INC"`. */
export function extrairTicker(produto: string): string | null {
  const t = produto.trim()
  if (!t) return null
  const idx = t.search(/\s+-\s+/)
  const token = (idx >= 0 ? t.slice(0, idx) : t).trim()
  const upper = token.toUpperCase()
  if (/^[A-Z][A-Z0-9]{3,5}$/.test(upper) && /\d/.test(upper)) return upper
  return null
}

/** Classifica a categoria pelo sufixo do ticker (BDR/FII/Ação). */
export function classificarCategoria(ticker: string): CategoriaAtivo | null {
  const t = ticker.trim().toUpperCase()
  if (/34$/.test(t)) return CategoriaAtivo.Bdr
  if (/11$|12$/.test(t)) return CategoriaAtivo.Fii
  if (/[3-8]$/.test(t)) return CategoriaAtivo.Acao
  return null
}

/** Mapeia o tipo de evento B3 para o `ProventoTipo` do domínio. */
export function mapearTipoProvento(evento: string): ProventoTipo | null {
  const n = normalizar(evento)
  if (n === normalizar('Dividendo')) return ProventoTipo.Dividendo
  if (n === normalizar('Juros Sobre Capital Próprio')) return ProventoTipo.Jcp
  if (n === normalizar('Rendimento')) return ProventoTipo.Rendimento
  return null
}

function fnv1a(texto: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function idProventoB3(
  ticker: string,
  dataPagamento: string,
  tipo: ProventoTipo,
  valorCentavos: number,
): string {
  return `b3p-${fnv1a([ticker, dataPagamento, tipo, valorCentavos].join('|'))}`
}

function idOperacaoB3(
  ticker: string,
  data: string,
  tipo: OperacaoTipo,
  quantidade: number,
  precoCentavos: number,
): string {
  return `b3o-${fnv1a([ticker, data, tipo, quantidade, precoCentavos].join('|'))}`
}

function detectarFormato(cabecalho: readonly string[]): B3Formato | null {
  const normalizado = cabecalho.map(normalizar).join('|')
  if (normalizado.includes('entradasaida')) return 'movimentacao'
  if (normalizado.includes('tipodeevento')) return 'proventos'
  return null
}

function linhaVazia(linha: readonly string[]): boolean {
  return linha.every((campo) => campo.trim().length === 0)
}

function temTotal(linha: readonly string[]): boolean {
  return linha.some((campo) => normalizar(campo) === 'total')
}

function parseValor(campo: string | undefined): number | null {
  if (!campo) return null
  const reais = parseDecimalBR(campo)
  return reais === null ? null : toCentavos(reais)
}

function processarLinhaProventos(
  linha: readonly string[],
  numeroLinha: number,
  proventos: Provento[],
  ignorados: B3LinhaIgnorada[],
): void {
  const produto = linha[0]?.trim() ?? ''
  if (produto.length === 0) return // rodapé (linha de total/valor)

  const ignorar = (motivo: string): void => {
    ignorados.push({ linha: numeroLinha, produto, movimentacao: linha[2]?.trim() ?? '', motivo })
  }

  const ticker = extrairTicker(produto)
  if (!ticker) return ignorar('Produto sem ticker reconhecível.')
  const categoria = classificarCategoria(ticker)
  if (!categoria) return ignorar('Categoria não reconhecida para o ticker.')
  const tipo = mapearTipoProvento(linha[2] ?? '')
  if (!tipo) return ignorar(`Tipo de evento não suportado (${linha[2]?.trim() ?? 'vazio'}).`)
  const dataPagamento = dataBRParaISO(linha[1] ?? '')
  if (!dataPagamento) return ignorar('Data de pagamento inválida.')
  const valor = parseValor(linha[6])
  if (valor === null || valor <= 0) return ignorar('Valor líquido inválido.')

  proventos.push({
    id: idProventoB3(ticker, dataPagamento, tipo, valor),
    dataCom: null,
    dataPagamento,
    categoria,
    ticker,
    tipo,
    valorTotal: valor,
  })
}

function processarLinhaMovimentacao(
  linha: readonly string[],
  numeroLinha: number,
  proventos: Provento[],
  operacoes: Operacao[],
  ignorados: B3LinhaIgnorada[],
): void {
  const produto = linha[3]?.trim() ?? ''
  const movimentacao = linha[2]?.trim() ?? ''
  if (produto.length === 0) return // rodapé/linha vazia

  const ignorar = (motivo: string): void => {
    ignorados.push({ linha: numeroLinha, produto, movimentacao, motivo })
  }

  const tipoProvento = mapearTipoProvento(movimentacao)
  if (tipoProvento) {
    const ticker = extrairTicker(produto)
    if (!ticker) return ignorar('Produto sem ticker reconhecível.')
    const categoria = classificarCategoria(ticker)
    if (!categoria) return ignorar('Categoria não reconhecida para o ticker.')
    const dataPagamento = dataBRParaISO(linha[1] ?? '')
    if (!dataPagamento) return ignorar('Data inválida.')
    const valor = parseValor(linha[7])
    if (valor === null || valor <= 0) return ignorar('Valor da operação inválido.')

    proventos.push({
      id: idProventoB3(ticker, dataPagamento, tipoProvento, valor),
      dataCom: null,
      dataPagamento,
      categoria,
      ticker,
      tipo: tipoProvento,
      valorTotal: valor,
    })
    return
  }

  if (normalizar(movimentacao) === 'transferencialiquidacao') {
    const ticker = extrairTicker(produto)
    if (!ticker) return ignorar('Produto sem ticker reconhecível.')
    const categoria = classificarCategoria(ticker)
    if (!categoria) return ignorar('Categoria não reconhecida para o ticker.')
    const data = dataBRParaISO(linha[1] ?? '')
    if (!data) return ignorar('Data inválida.')
    const quantidade = parseDecimalBR(linha[5] ?? '')
    const preco = parseDecimalBR(linha[6] ?? '')
    if (quantidade === null || quantidade <= 0) return ignorar('Quantidade indisponível.')
    if (preco === null || preco <= 0) return ignorar('Preço unitário indisponível.')

    const direcao = normalizar(linha[0] ?? '')
    let tipo: OperacaoTipo
    if (direcao.startsWith('cred')) tipo = OperacaoTipo.Compra
    else if (direcao.startsWith('deb')) tipo = OperacaoTipo.Venda
    else return ignorar('Direção (Crédito/Débito) inválida.')

    const precoCentavos = toCentavos(preco)
    operacoes.push({
      id: idOperacaoB3(ticker, data, tipo, quantidade, precoCentavos),
      data,
      tipo,
      categoria,
      ticker,
      quantidade,
      precoUnitario: precoCentavos,
      taxas: 0,
      indexador: null,
      percentualIndexador: null,
      vencimento: null,
      valorBrutoAtual: null,
    })
    return
  }

  return ignorar(`Movimentação não suportada (${movimentacao || 'vazia'}).`)
}

/**
 * Analisa um arquivo CSV da B3 e retorna proventos, operações e linhas
 * ignoradas. Nunca lança: entradas inesperadas geram apenas linhas ignoradas.
 */
export function analisarExtratoB3(texto: string): B3ParseResult {
  const linhas = parseCsv(texto)
  const resultado: B3ParseResult = {
    formato: null,
    proventos: [],
    operacoes: [],
    ignorados: [],
    totalLinhas: Math.max(0, linhas.length - 1),
  }
  if (linhas.length === 0) return resultado

  resultado.formato = detectarFormato(linhas[0])

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i]
    if (linhaVazia(linha) || temTotal(linha)) continue

    if (resultado.formato === 'proventos') {
      processarLinhaProventos(linha, i + 1, resultado.proventos, resultado.ignorados)
    } else if (resultado.formato === 'movimentacao') {
      processarLinhaMovimentacao(
        linha,
        i + 1,
        resultado.proventos,
        resultado.operacoes,
        resultado.ignorados,
      )
    } else {
      resultado.ignorados.push({
        linha: i + 1,
        produto: linha[3] ?? linha[0] ?? '',
        movimentacao: linha[2] ?? '',
        motivo: 'Formato de arquivo não reconhecido.',
      })
    }
  }

  return resultado
}
