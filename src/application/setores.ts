import { usaGoogFinance } from '@/domain/categoria'
import type { Ativo, CategoriaAtivo } from '@/domain/entities'
import type { TokensProvedores } from '@/domain/provedoresCotacao'
import { ativosRepo } from '@/infrastructure/repositories'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { provedorSetores } from '@/infrastructure/cotacoes/registro'
import { ensureRequiredSheets } from '@/infrastructure/sheets/gatewayRouter'

/**
 * Setor de atuação por ticker — carga e persistência (aba `Ativos`).
 *
 * O setor é **metadado do ativo** (não da operação): é buscado uma vez nas
 * integrações (Brapi → Mais Retorno), gravado na aba `Ativos` e reaproveitado
 * nas próximas cargas. O dashboard usa o mapa para o gráfico "Por setor"; quem
 * não tiver setor simplesmente não entra no gráfico.
 *
 * Garantias (RNF04):
 * - **nunca lança**: falha de rede/token/formato apenas deixa o ativo sem setor;
 * - **best-effort na escrita**: se a gravação falhar, o mapa continua válido em
 *   memória para a carga atual;
 * - **uma consulta por ticker por sessão**: evita repetir a API a cada
 *   carregamento do dashboard;
 * - **aba garantida antes da escrita**: planilhas abertas antes desta versão não
 *   têm a aba `Ativos` — `ensureRequiredSheets` a cria (idempotente) sem exigir
 *   reabrir a planilha.
 */

/** Ticker com a categoria, para filtrar apenas o que pode ter setor. */
export interface TickerCategoria {
  ticker: string
  categoria: CategoriaAtivo
}

/** Opções da carga de setores. */
export interface OpcoesCarregarSetores {
  tokens: TokensProvedores
  /** Modo offline (RNF08): usa apenas o que já está gravado/cacheado. */
  offline?: boolean
}

/**
 * Tickers consultados nesta sessão do app (inclusive os que voltaram sem
 * setor). Evita repetir a consulta a cada re-render/carga do dashboard.
 */
const consultadosNaSessao = new Set<string>()

/**
 * Planilhas em que a aba `Ativos` já foi verificada nesta sessão. Evita um
 * `batchUpdate` de metadados a cada carga do dashboard.
 */
const planilhasComAbaVerificada = new Set<string>()

function chave(ticker: string): string {
  return ticker.trim().toUpperCase()
}

/**
 * Garante as abas do schema na origem ativa (cria as ausentes em planilhas e
 * arquivos antigos).
 *
 * Idempotente e memoizado por sessão; best-effort: falha de rede/quota não
 * bloqueia a leitura (é tentado de novo na próxima carga).
 */
export async function garantirAbasDoSchema(context: RepositoryContext): Promise<void> {
  if (planilhasComAbaVerificada.has(context.spreadsheetId)) return
  try {
    await ensureRequiredSheets(context.accessToken, context.spreadsheetId)
    planilhasComAbaVerificada.add(context.spreadsheetId)
  } catch {
    // Best-effort: a próxima carga tenta de novo.
  }
}

/** `true` para as categorias de B3 que têm setor de atuação. */
export function temSetor(categoria: CategoriaAtivo): boolean {
  return usaGoogFinance(categoria)
}

/** Tickers elegíveis (B3) a partir das posições do consolidado. */
export function tickersComSetor(linhas: readonly TickerCategoria[]): string[] {
  const tickers: string[] = []
  const vistos = new Set<string>()
  for (const linha of linhas) {
    if (!temSetor(linha.categoria)) continue
    const normalizado = chave(linha.ticker)
    if (normalizado.length === 0 || vistos.has(normalizado)) continue
    vistos.add(normalizado)
    tickers.push(normalizado)
  }
  return tickers
}

/** Mapa `ticker → setor` a partir das linhas da aba `Ativos` (ignora vazios). */
export function mapaDeSetores(ativos: readonly Ativo[]): Map<string, string> {
  const setores = new Map<string, string>()
  for (const ativo of ativos) {
    const ticker = chave(ativo.ticker)
    const setor = ativo.setor.trim()
    if (ticker.length === 0 || setor.length === 0) continue
    setores.set(ticker, setor)
  }
  return setores
}

/** Lê a aba `Ativos` de forma tolerante (planilhas antigas podem não tê-la). */
async function listarAtivos(
  context: RepositoryContext,
  offline: boolean,
): Promise<Ativo[]> {
  if (offline) return ativosRepo.readCache(context.spreadsheetId) ?? []
  try {
    return await ativosRepo.list(context)
  } catch {
    return ativosRepo.readCache(context.spreadsheetId) ?? []
  }
}

/**
 * Mescla os setores obtidos nas linhas da aba `Ativos`, preservando as linhas
 * existentes (e a ordem) e acrescentando as novas ao final.
 */
function mesclarAtivos(
  atuais: readonly Ativo[],
  encontrados: ReadonlyMap<string, string>,
  posicoes: readonly TickerCategoria[],
): Ativo[] {
  const categoriaPorTicker = new Map<string, CategoriaAtivo>()
  for (const posicao of posicoes) {
    const ticker = chave(posicao.ticker)
    if (ticker.length > 0 && !categoriaPorTicker.has(ticker)) {
      categoriaPorTicker.set(ticker, posicao.categoria)
    }
  }

  const proximos: Ativo[] = atuais.map((ativo) => {
    const ticker = chave(ativo.ticker)
    const setor = encontrados.get(ticker)
    return setor && setor !== ativo.setor ? { ...ativo, setor } : ativo
  })

  const conhecidos = new Set(proximos.map((ativo) => chave(ativo.ticker)))
  for (const [ticker, setor] of encontrados) {
    if (conhecidos.has(ticker)) continue
    const categoria = categoriaPorTicker.get(ticker)
    if (!categoria) continue
    proximos.push({ ticker, categoria, setor })
    conhecidos.add(ticker)
  }

  return proximos
}

/**
 * Carrega o mapa `ticker → setor` das posições informadas.
 *
 * Lê a aba `Ativos` (cache-first), consulta as integrações apenas para os
 * tickers ainda sem setor e persiste o que voltou. Em modo offline devolve o
 * que já está gravado, sem rede.
 */
export async function carregarSetores(
  context: RepositoryContext,
  posicoes: readonly TickerCategoria[],
  opcoes: OpcoesCarregarSetores,
): Promise<Map<string, string>> {
  const offline = opcoes.offline === true
  // Planilhas antigas podem não ter a aba `Ativos`: garante antes de ler/gravar.
  if (!offline) await garantirAbasDoSchema(context)

  const ativos = await listarAtivos(context, offline)
  const setores = mapaDeSetores(ativos)

  const tickers = tickersComSetor(posicoes)
  const pendentes = tickers.filter(
    (ticker) => !setores.has(ticker) && !consultadosNaSessao.has(ticker),
  )
  if (offline || pendentes.length === 0) return setores

  for (const ticker of pendentes) consultadosNaSessao.add(ticker)

  const resultado = await provedorSetores.atualizar(pendentes, {
    tokens: opcoes.tokens,
    // O setor é quase estático: o cache longo das integrações governa a
    // atualização (não é forçado pelo "Atualizar" das cotações).
    forceRefresh: false,
  })
  if (resultado.setores.size === 0) return setores

  const proximos = mesclarAtivos(ativos, resultado.setores, posicoes)
  try {
    await ativosRepo.replaceAll(context, proximos)
  } catch {
    // Best-effort: a próxima carga tenta de novo.
    for (const ticker of pendentes) consultadosNaSessao.delete(ticker)
  }

  for (const [ticker, setor] of resultado.setores) setores.set(ticker, setor)
  return setores
}

/** Limpa o controle de sessão (usado em testes). */
export function limparControleDeSessaoSetores(): void {
  consultadosNaSessao.clear()
  planilhasComAbaVerificada.clear()
}
