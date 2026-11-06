import { estadoDoBanco } from '@/application/criptografia'
import { estadoPlanilhaCotacoes } from '@/application/planilhaCotacoes'
import type { SheetName } from '@/domain/sheetsSchema'
import type { RepositoryContext } from '@/infrastructure/repositories'
import {
  consolidadoRepo,
  historicoRepo,
  metasRepo,
  operacoesRepo,
  prefetchAllSheets,
  proventosRepo,
} from '@/infrastructure/repositories'
import {
  criptografiaDisponivel,
  getSheetsRequestCount,
  resetSheetsRequestCount,
} from '@/infrastructure/sheets/gatewayRouter'

/**
 * Diagnóstico da camada de dados e das integrações.
 *
 * O teste da camada de dados é **somente leitura**: faz **um** `batchGet` para
 * atualizar o cache de todas as abas e relê do cache **sem novas chamadas** à
 * API. Nenhuma linha de teste é gravada — o diagnóstico não cria tickers nem
 * polui as abas do usuário.
 *
 * Os contadores vêm do `gatewayRouter`, ou seja, do backend ativo: no modo
 * Google com `VITE_GOOGLE_BACKEND=sheets` contam chamadas à API do Sheets; com
 * `json`, contam chamadas à API de arquivos do Drive.
 *
 * Além dos contadores, o relatório traz o **estado do ambiente** —
 * criptografia do banco e planilha de cotações (`lerDiagnosticoAmbiente`) —,
 * lido sem escrever nada e sem derrubar o diagnóstico quando a leitura falha.
 */

/** Situação do banco quanto à cifra (`PLANO_CRIPTOGRAFIA.md` §3.3). */
export interface DiagnosticCriptografia {
  estado: 'nenhuma' | 'total'
  /** `true` quando o banco está cifrado e esta sessão ainda não tem a chave. */
  bloqueado: boolean
  /** `true` quando este backend/navegador consegue cifrar o banco. */
  disponivel: boolean
  /**
   * `true` quando o estado foi lido do arquivo/cofre (magic dos bytes).
   * `false` significa que só existe uma estimativa local — a tela não deve
   * afirmar "sem criptografia" nesse caso.
   */
  verificado: boolean
}

/** Situação da planilha de cotações — fonte opcional (§4.2). */
export interface DiagnosticPlanilhaCotacoes {
  estado: 'ativa' | 'nao-autorizada' | 'indisponivel'
  motivo: string | null
}

/** Bloco do relatório que só **lê** o estado: nada é escrito no banco. */
export interface DiagnosticAmbiente {
  criptografia: DiagnosticCriptografia
  planilhaCotacoes: DiagnosticPlanilhaCotacoes
}

/** Resultado por aba (só leitura do cache). */
export interface DiagnosticSheetResult {
  sheetName: SheetName
  /** Quantidade de linhas lidas do cache após a leitura agrupada. */
  cachedRowCount: number
}

/** Relatório completo do diagnóstico. */
export interface DiagnosticReport extends DiagnosticAmbiente {
  startedAt: string
  finishedAt: string
  /** Total de requisições de rede ao backend durante o diagnóstico. */
  totalRequests: number
  /** Requisições gastas na leitura agrupada das abas (`values.batchGet`). */
  readRequests: number
  /** Requisições gastas ao reler do cache (deve ser `0`). */
  cacheReadRequests: number
  /** `true` quando reler do cache não gerou nenhuma chamada à API. */
  cacheReadUsedNoRequests: boolean
  sheets: DiagnosticSheetResult[]
}

/**
 * Lê o estado da criptografia e da planilha de cotações **sem escrever** nada.
 *
 * A planilha de cotações responde só com o estado local (sem rede). A
 * criptografia vem do gateway — magic do arquivo (uma leitura) ou meta do cofre
 * local — e por isso fica em `try/catch`: um diagnóstico não pode falhar por
 * causa de um dado auxiliar (offline, arquivo apagado, 403).
 */
export async function lerDiagnosticoAmbiente(
  context: RepositoryContext | null,
): Promise<DiagnosticAmbiente> {
  const planilhaCotacoes = estadoPlanilhaCotacoes()
  const semLeitura: DiagnosticCriptografia = {
    estado: 'nenhuma',
    bloqueado: false,
    disponivel: criptografiaDisponivel(),
    verificado: false,
  }

  if (!context) return { criptografia: semLeitura, planilhaCotacoes }

  try {
    const { estado, bloqueado, disponivel } = await estadoDoBanco(context)
    return {
      criptografia: { estado, bloqueado, disponivel, verificado: true },
      planilhaCotacoes,
    }
  } catch {
    return { criptografia: semLeitura, planilhaCotacoes }
  }
}

/** Executa o diagnóstico da camada de dados (lança em caso de falha de leitura). */
export async function runDataLayerDiagnostics(
  context: RepositoryContext,
): Promise<DiagnosticReport> {
  resetSheetsRequestCount()
  const startedAt = new Date().toISOString()

  // 1) Leitura agrupada: uma única chamada `values.batchGet` para todas as abas.
  await prefetchAllSheets(context)
  const readRequests = getSheetsRequestCount()

  // 2) Releitura do cache: não deve disparar nenhuma chamada à API.
  const requestsBeforeCacheRead = getSheetsRequestCount()
  const sheets: DiagnosticSheetResult[] = [
    {
      sheetName: 'Operacoes',
      cachedRowCount: operacoesRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Proventos',
      cachedRowCount: proventosRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Consolidado',
      cachedRowCount: consolidadoRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Metas_Rebalanceamento',
      cachedRowCount: metasRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
    {
      sheetName: 'Historico',
      cachedRowCount: historicoRepo.readCache(context.spreadsheetId)?.length ?? 0,
    },
  ]
  const cacheReadRequests = getSheetsRequestCount() - requestsBeforeCacheRead
  const totalRequests = getSheetsRequestCount()

  // O ambiente é lido **depois** de fechar os contadores: no cofre JSON ele
  // baixa o arquivo, e o diagnóstico mede só a leitura das abas e o cache.
  const ambiente = await lerDiagnosticoAmbiente(context)
  const finishedAt = new Date().toISOString()

  return {
    startedAt,
    finishedAt,
    totalRequests,
    readRequests,
    cacheReadRequests,
    cacheReadUsedNoRequests: cacheReadRequests === 0,
    sheets,
    ...ambiente,
  }
}
