import { toCentavos } from '@/domain/money'

/**
 * Títulos do **Tesouro Direto** obtidos da Brapi (`/api/v2/treasury/list`) e o
 * casamento com os tickers da carteira (`"Tesouro Selic 2029"`, ...).
 *
 * Módulo **puro**. O ticker do usuário é livre; o casamento usa a família do
 * título (nome normalizado, aceitando nomes antigos como `LFT`/`NTN-B`) e o
 * vencimento (data completa quando conhecida; senão apenas o ano). O `symbol`
 * da Brapi (`tesouro-selic-01032031`) também é aceito como ticker.
 */

/** Título do Tesouro Direto com o preço indicativo mais recente. */
export interface TituloTesouro {
  /** Código Brapi (`tesouro-selic-01032031`). */
  symbol: string
  /** Nome do título (`Tesouro Selic`). */
  bondType: string
  /** Vencimento `YYYY-MM-DD`. */
  maturityDate: string
  /** Preço unitário de resgate (venda) em **centavos**. */
  preco: number
  /** Data-base do preço (`YYYY-MM-DD`); `null` quando ausente. */
  dataBase: string | null
}

function isRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function precoEmCentavos(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return toCentavos(value)
}

function dataISO(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

/**
 * Extrai os títulos da resposta da Brapi (`{ results: [...] }`, usada por
 * `/treasury/list` e `/treasury/indicators`). O preço é o de **resgate**
 * (`sellPrice`, com `basePrice` como alternativa) — o valor de mercado de
 * quem já tem o título. Itens inválidos são ignorados.
 */
export function extrairTitulosTesouro(payload: unknown): TituloTesouro[] {
  if (!isRegistro(payload) || payload.error === true || !Array.isArray(payload.results)) {
    return []
  }
  const titulos: TituloTesouro[] = []
  for (const item of payload.results) {
    if (!isRegistro(item)) continue
    const symbol = typeof item.symbol === 'string' ? item.symbol.trim().toLowerCase() : ''
    const bondType = typeof item.bondType === 'string' ? item.bondType.trim() : ''
    const maturityDate = dataISO(item.maturityDate)
    const preco = precoEmCentavos(item.sellPrice) ?? precoEmCentavos(item.basePrice)
    if (symbol.length === 0 || !maturityDate || preco === null) continue
    titulos.push({ symbol, bondType, maturityDate, preco, dataBase: dataISO(item.baseDate) })
  }
  return titulos
}

/** Remove acentos, caixa e tudo que não for letra/dígito. */
function normalizar(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Nomes antigos (siglas) dos títulos públicos → família atual normalizada. */
const ALIASES_FAMILIA: Readonly<Record<string, string>> = {
  lft: 'tesouroselic',
  ltn: 'tesouroprefixado',
  ntnf: 'tesouroprefixadocomjurossemestrais',
  ntnb: 'tesouroipcacomjurossemestrais',
  ntnbprincipal: 'tesouroipca',
  ntnc: 'tesouroigpmcomjurossemestrais',
}

/** Família normalizada a partir de um nome livre (resolvendo siglas antigas). */
function familiaNormalizada(nome: string): string {
  const chave = normalizar(nome)
  return ALIASES_FAMILIA[chave] ?? chave
}

/** Família normalizada do título (pelo `bondType` ou pelo `symbol` sem a data). */
function familiasDoTitulo(titulo: TituloTesouro): string[] {
  const doSymbol = normalizar(titulo.symbol.replace(/-?\d{8}$/, ''))
  const doNome = normalizar(titulo.bondType)
  return doNome.length > 0 && doNome !== doSymbol ? [doNome, doSymbol] : [doSymbol]
}

/** Ticker da carteira decomposto em família + vencimento. */
interface TickerTesouro {
  familia: string
  /** Vencimento completo (`YYYY-MM-DD`) quando informado no ticker. */
  data: string | null
  ano: string | null
}

/**
 * Decompõe `"Tesouro IPCA+ 2035"`, `"Tesouro Selic 01/03/2029"` ou
 * `"NTN-B Principal 15/05/2035"` em família + vencimento.
 */
function decomporTicker(ticker: string): TickerTesouro {
  const texto = ticker.trim()
  const comData = texto.match(/^(.*?)[\s-]*(\d{2})[/.-](\d{2})[/.-](\d{4})$/)
  if (comData) {
    const [, nome, dia, mes, ano] = comData
    return { familia: familiaNormalizada(nome ?? ''), data: `${ano}-${mes}-${dia}`, ano: ano ?? null }
  }
  const comAno = texto.match(/^(.*?)[\s-]*(\d{4})$/)
  if (comAno) {
    const [, nome, ano] = comAno
    return { familia: familiaNormalizada(nome ?? ''), data: null, ano: ano ?? null }
  }
  return { familia: familiaNormalizada(texto), data: null, ano: null }
}

/**
 * Encontra o título da Brapi correspondente ao ticker da carteira.
 *
 * Ordem: `symbol` idêntico → família exata + vencimento → família por prefixo
 * (ex.: `"Tesouro Renda+ 2065"` → `Tesouro Renda+ Aposentadoria Extra`),
 * desde que o resultado seja único. `vencimento` (ISO, da operação) refina o
 * casamento quando o ticker traz apenas o ano. Retorna `null` se não houver
 * correspondência inequívoca.
 */
export function encontrarTituloTesouro(
  ticker: string,
  titulos: readonly TituloTesouro[],
  vencimento: string | null = null,
): TituloTesouro | null {
  const symbol = ticker.trim().toLowerCase()
  const porSymbol = titulos.find((titulo) => titulo.symbol === symbol)
  if (porSymbol) return porSymbol

  const decomposto = decomporTicker(ticker)
  if (decomposto.familia.length === 0 || !decomposto.ano) return null
  if (decomposto.data) return casarPorVencimento(decomposto, titulos, decomposto.data)

  const daOperacao = vencimento?.startsWith(`${decomposto.ano}-`) ? vencimento : null
  return (
    (daOperacao ? casarPorVencimento(decomposto, titulos, daOperacao) : null) ??
    casarPorVencimento(decomposto, titulos, null)
  )
}

/** Casa a família entre os títulos do vencimento (data exata ou só o ano). */
function casarPorVencimento(
  decomposto: TickerTesouro,
  titulos: readonly TituloTesouro[],
  data: string | null,
): TituloTesouro | null {
  const doVencimento = titulos.filter((titulo) =>
    data ? titulo.maturityDate === data : titulo.maturityDate.startsWith(`${decomposto.ano}-`),
  )
  const exatos = doVencimento.filter((titulo) =>
    familiasDoTitulo(titulo).includes(decomposto.familia),
  )
  if (exatos.length > 0) return exatos.length === 1 ? exatos[0]! : null

  const porPrefixo = doVencimento.filter((titulo) =>
    familiasDoTitulo(titulo).some((familia) => familia.startsWith(decomposto.familia)),
  )
  return porPrefixo.length === 1 ? porPrefixo[0]! : null
}
