import { CheckCircle2, Eye, EyeOff, KeyRound, Link2, Loader2, Save, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/authContext'
import { Alert } from '@/components/Alert'
import { FormField, inputClassName } from '@/components/FormField'
import { DEFAULT_TESOURO_API_URL } from '@/domain/configuracoes'
import { carregarConfiguracoes, salvarConfiguracoes } from '@/services/configuracoes'
import { clearBrapiCache } from '@/services/brapi'
import { describeSheetsError } from '@/services/sheets'
import { clearTesouroCache } from '@/services/tesouro'

/**
 * Página de configurações das integrações (aba `Configuracoes` da planilha).
 *
 * As credenciais/ajustes ficam **no próprio arquivo do usuário** (Google Sheets)
 * em vez de variáveis de ambiente — cada usuário configura as suas integrações
 * sem recompilar o app. Ao salvar, os caches de cotação são limpos para que os
 * novos valores passem a valer imediatamente.
 */
export function ConfiguracoesPage() {
  const { workspace, ensureAccessToken } = useAuth()
  const [tesouroApiUrl, setTesouroApiUrl] = useState('')
  const [brapiToken, setBrapiToken] = useState('')
  const [mostrarToken, setMostrarToken] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!workspace) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const accessToken = await ensureAccessToken()
      if (!accessToken) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      const config = await carregarConfiguracoes({
        accessToken,
        spreadsheetId: workspace.spreadsheetId,
      })
      setTesouroApiUrl(config.tesouroApiUrl)
      setBrapiToken(config.brapiToken)
    } catch (loadError) {
      setError(describeSheetsError(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [workspace, ensureAccessToken])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar() {
    setError(null)
    setNotice(null)
    if (!workspace) {
      setError('Configure uma planilha antes de salvar as configurações.')
      return
    }
    setIsSaving(true)
    try {
      const accessToken = await ensureAccessToken()
      if (!accessToken) {
        setError('Sessão expirada. Faça login novamente.')
        return
      }
      await salvarConfiguracoes(
        { accessToken, spreadsheetId: workspace.spreadsheetId },
        { tesouroApiUrl, brapiToken },
      )
      // Invalida os caches para que os novos valores valham já na próxima busca.
      clearTesouroCache()
      clearBrapiCache()
      setNotice('Configurações salvas na planilha.')
    } catch (saveError) {
      setError(describeSheetsError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  if (!workspace) {
    return (
      <section className="space-y-5">
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Settings className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold text-slate-900">Configurações</h1>
        </header>
        <Alert variant="info" title="Nenhuma planilha configurada">
          Selecione ou crie uma planilha em{' '}
          <Link to="/dashboard" className="font-semibold underline">
            Dashboard
          </Link>{' '}
          para editar as configurações.
        </Alert>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Settings className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Configurações</h1>
          <p className="text-sm text-slate-500">
            Integrações do app ficam salvas na própria planilha ({workspace.title}).
          </p>
        </div>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? (
        <Alert variant="success">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {notice}
          </span>
        </Alert>
      ) : null}

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Link2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">
              Endpoint do Tesouro Direto
            </h2>
            <p className="text-xs text-slate-500">
              Endereço da API de dados abertos do Tesouro Nacional, usado para buscar a cotação
              dos títulos do Tesouro Direto (RF19). <strong>Sobrescreve</strong> o endpoint público
              padrão. Deixe em branco para usar o padrão — na maioria dos casos não é preciso
              alterar.
            </p>
          </div>
        </div>

        <FormField
          htmlFor="tesouro-api-url"
          label="Tesouro API URL"
          hint={
            tesouroApiUrl.trim().length === 0
              ? `Em branco: usa o padrão (${DEFAULT_TESOURO_API_URL})`
              : 'Endpoint personalizado será usado nas próximas buscas de cotação.'
          }
        >
          <input
            id="tesouro-api-url"
            type="url"
            value={tesouroApiUrl}
            onChange={(evento) => setTesouroApiUrl(evento.target.value)}
            placeholder={DEFAULT_TESOURO_API_URL}
            spellCheck={false}
            autoComplete="off"
            className={inputClassName}
            disabled={isLoading || isSaving}
          />
        </FormField>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <KeyRound className="h-4 w-4" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Token da Brapi.dev</h2>
            <p className="text-xs text-slate-500">
              Usado como <strong>fallback de cotação da B3</strong> (Ação/FII/BDR/ETF) quando o
              <code className="mx-1 rounded bg-slate-100 px-1">GOOGLEFINANCE</code>da planilha não
              retorna preço.
            </p>
            <p className="text-xs text-slate-500">
              <strong>Como obter:</strong> crie uma conta gratuita em{' '}
              <a
                href="https://brapi.dev"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-600 underline"
              >
                brapi.dev
              </a>
              , acesse o painel e copie o seu <em>token</em>. Deixe em branco para desativar o
              fallback.
            </p>
          </div>
        </div>

        <FormField
          htmlFor="brapi-token"
          label="Token da Brapi"
          hint="Fica salvo na sua planilha do Google Drive — não é enviado a nenhum servidor do app."
        >
          <div className="flex items-center gap-2">
            <input
              id="brapi-token"
              type={mostrarToken ? 'text' : 'password'}
              value={brapiToken}
              onChange={(evento) => setBrapiToken(evento.target.value)}
              placeholder="Cole aqui o seu token"
              spellCheck={false}
              autoComplete="off"
              className={inputClassName}
              disabled={isLoading || isSaving}
            />
            <button
              type="button"
              onClick={() => setMostrarToken((valor) => !valor)}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
              aria-label={mostrarToken ? 'Ocultar token' : 'Mostrar token'}
            >
              {mostrarToken ? (
                <EyeOff className="h-4 w-4" aria-hidden />
              ) : (
                <Eye className="h-4 w-4" aria-hidden />
              )}
              {mostrarToken ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </FormField>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={isLoading || isSaving}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Salvar configurações
        </button>
      </div>
    </section>
  )
}
