import { FileUp, Loader2, Trash2, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/presentation/app/providers/authContext'
import { Alert } from '@/presentation/components/Alert'
import { analisarExtratoB3 } from '@/domain/b3Import'
import type { B3ParseResult } from '@/domain/b3Import'
import { formatarDataBR } from '@/domain/dates'
import { formatarBRL, fromCentavos } from '@/domain/money'
import { importarExtratoB3 } from '@/application/b3Import'
import type { RepositoryContext } from '@/infrastructure/repositories'
import { describeSheetsError } from '@/infrastructure/sheets/gateway'

/**
 * Importação de extratos CSV da B3 (Área do Investidor) — RF23, Etapa 8.
 *
 * O usuário baixa os arquivos na B3 e importa aqui. O app detecta o formato
 * pelo cabeçalho, mostra uma prévia e importa com deduplicação por ID
 * determinístico (reimportar o mesmo arquivo não duplica).
 */
export function ImportarB3Page() {
  const { workspace, ensureAccessToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [resultado, setResultado] = useState<B3ParseResult | null>(null)
  const [nomesArquivos, setNomesArquivos] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const resolveContext = useCallback(async (): Promise<RepositoryContext | null> => {
    if (!workspace) {
      setError('Configure uma planilha antes de importar.')
      return null
    }
    const token = await ensureAccessToken()
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return null
    }
    return { accessToken: token, spreadsheetId: workspace.spreadsheetId }
  }, [workspace, ensureAccessToken])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setError(null)
    setNotice(null)
    try {
      const arquivos = Array.from(fileList)
      const acumulado: B3ParseResult = {
        formato: null,
        proventos: [],
        operacoes: [],
        ignorados: [],
        totalLinhas: 0,
      }
      for (const arquivo of arquivos) {
        const texto = await arquivo.text()
        const parcial = analisarExtratoB3(texto)
        if (parcial.formato) acumulado.formato = parcial.formato
        acumulado.proventos.push(...parcial.proventos)
        acumulado.operacoes.push(...parcial.operacoes)
        acumulado.ignorados.push(...parcial.ignorados)
        acumulado.totalLinhas += parcial.totalLinhas
      }
      setResultado(acumulado)
      setNomesArquivos(arquivos.map((arquivo) => arquivo.name))
    } catch {
      setError('Não foi possível ler os arquivos selecionados.')
      setResultado(null)
    }
  }

  async function handleImportar() {
    if (!resultado) return
    const context = await resolveContext()
    if (!context) return
    setIsImporting(true)
    setError(null)
    setNotice(null)
    try {
      const stats = await importarExtratoB3(context, resultado)
      setNotice(
        `Importação concluída: ${stats.proventosNovos} provento(s) e ${stats.operacoesNovas} operação(ões) novas; ${stats.duplicadosIgnorados} registro(s) já existentes.`,
      )
      setResultado(null)
      setNomesArquivos([])
      if (inputRef.current) inputRef.current.value = ''
    } catch (importError) {
      setError(describeSheetsError(importError))
    } finally {
      setIsImporting(false)
    }
  }

  function limpar() {
    setResultado(null)
    setNomesArquivos([])
    setError(null)
    setNotice(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const proventos = resultado?.proventos ?? []
  const operacoes = resultado?.operacoes ?? []
  const ignorados = resultado?.ignorados ?? []

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <FileUp className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Importar B3</h1>
            <p className="text-sm text-slate-500">
              Importe os extratos CSV exportados da Área do Investidor da B3.
            </p>
          </div>
        </div>
      </header>

      {!workspace ? (
        <Alert variant="info" title="Nenhuma planilha configurada">
          Selecione ou crie uma planilha em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          antes de importar.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label
          htmlFor="b3-arquivos"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40"
        >
          <Upload className="h-8 w-8 text-slate-400" aria-hidden />
          <span className="text-sm font-semibold text-slate-700">
            Selecione os arquivos CSV da B3
          </span>
          <span className="text-xs text-slate-500">
            Formatos: extrato de proventos e extrato de movimentação (Área do Investidor).
          </span>
        </label>
        <input
          ref={inputRef}
          id="b3-arquivos"
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {resultado ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-medium">Arquivos:</span>
            {nomesArquivos.map((nome) => (
              <span key={nome} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs">
                {nome}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Proventos</p>
              <p className="text-2xl font-semibold text-slate-900">{proventos.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Operações</p>
              <p className="text-2xl font-semibold text-slate-900">{operacoes.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Ignoradas</p>
              <p className="text-2xl font-semibold text-amber-600">{ignorados.length}</p>
            </div>
          </div>

          {proventos.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                Prévia de proventos
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Pagamento</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Tipo</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proventos.slice(0, 20).map((provento) => (
                      <tr key={provento.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono font-medium text-slate-900">{provento.ticker}</td>
                        <td className="px-4 py-2 tabular-nums text-slate-700">
                          {formatarDataBR(provento.dataPagamento)}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{provento.tipo}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                          {formatarBRL(fromCentavos(provento.valorTotal))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {proventos.length > 20 ? (
                <p className="px-4 py-2 text-xs text-slate-500">
                  Exibindo 20 de {proventos.length} registros.
                </p>
              ) : null}
            </div>
          ) : null}

          {operacoes.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                Prévia de operações
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">Data</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Tipo</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Ticker</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Qtd</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operacoes.slice(0, 20).map((operacao) => (
                      <tr key={operacao.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 tabular-nums text-slate-700">{formatarDataBR(operacao.data)}</td>
                        <td className="px-4 py-2 text-slate-700">{operacao.tipo}</td>
                        <td className="px-4 py-2 font-mono font-medium text-slate-900">{operacao.ticker}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">{operacao.quantidade}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                          {formatarBRL(fromCentavos(operacao.precoUnitario))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {operacoes.length > 20 ? (
                <p className="px-4 py-2 text-xs text-slate-500">
                  Exibindo 20 de {operacoes.length} registros.
                </p>
              ) : null}
            </div>
          ) : null}

          {ignorados.length > 0 ? (
            <details className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-800">
                {ignorados.length} linha(s) ignorada(s) — clique para ver os motivos
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-amber-700">
                {ignorados.slice(0, 50).map((item) => (
                  <li key={item.linha}>
                    Linha {item.linha}: {item.motivo}
                    {item.produto ? ` (${item.produto})` : ''}
                  </li>
                ))}
              </ul>
              {ignorados.length > 50 ? (
                <p className="mt-2 text-xs text-amber-700">
                  Exibindo 50 de {ignorados.length} linhas.
                </p>
              ) : null}
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleImportar()}
              disabled={isImporting || proventos.length + operacoes.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              Importar
            </button>
            <button
              type="button"
              onClick={limpar}
              disabled={isImporting}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Limpar
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
