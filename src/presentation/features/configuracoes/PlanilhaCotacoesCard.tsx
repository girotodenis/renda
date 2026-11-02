import { FileSpreadsheet, Loader2, ShieldCheck, Unplug } from 'lucide-react'
import { useState } from 'react'
import {
  MSG_PLANILHA_NAO_AUTORIZADA,
  autorizarPlanilhaCotacoes,
  desconectarPlanilhaCotacoes,
  estadoPlanilhaCotacoes,
} from '@/application/planilhaCotacoes'
import type { EstadoPlanilhaCotacoes } from '@/application/planilhaCotacoes'
import { useAuth } from '@/presentation/app/providers/authContext'
import { cn } from '@/presentation/cn'
import { Alert } from '@/presentation/components/Alert'

const ESTADO_LABEL: Record<EstadoPlanilhaCotacoes['estado'], string> = {
  ativa: 'Ativa',
  'nao-autorizada': 'Não autorizada',
  indisponivel: 'Indisponível',
}

const ESTADO_CLASSE: Record<EstadoPlanilhaCotacoes['estado'], string> = {
  ativa: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'nao-autorizada': 'bg-slate-100 text-slate-600 ring-slate-200',
  indisponivel: 'bg-amber-50 text-amber-700 ring-amber-200',
}

/**
 * Card "Planilha de cotações" (§6.5).
 *
 * A planilha é uma fonte **opcional** de cotações: o app cria e mantém um
 * arquivo só com tickers e preços. Nada é pedido ao Google sem clique do
 * usuário — negar não muda o dashboard (as APIs assumem).
 */
export function PlanilhaCotacoesCard() {
  const { isModoLocal } = useAuth()
  const [info, setInfo] = useState<EstadoPlanilhaCotacoes>(() => estadoPlanilhaCotacoes())
  const [autorizando, setAutorizando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const ativa = info.estado === 'ativa'

  async function autorizar() {
    setErro(null)
    setAviso(null)
    setAutorizando(true)
    try {
      const resultado = await autorizarPlanilhaCotacoes()
      setInfo(estadoPlanilhaCotacoes())
      if (resultado.status === 'negada') setAviso(MSG_PLANILHA_NAO_AUTORIZADA)
      if (resultado.status === 'erro') setErro(resultado.mensagem)
    } finally {
      setAutorizando(false)
    }
  }

  function desconectar() {
    setErro(null)
    setAviso(null)
    desconectarPlanilhaCotacoes()
    setInfo(estadoPlanilhaCotacoes())
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">Planilha de cotações</h2>
          <p className="text-xs text-slate-500">
            Fonte <strong>opcional</strong> de cotações da B3 via{' '}
            <code className="rounded bg-slate-100 px-1">GOOGLEFINANCE</code>. O app cria e mantém
            uma planilha separada com apenas os <strong>tickers</strong> e os preços — a carteira
            nunca vive nela. Sem autorização, as cotações usam as APIs.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Estado:</span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset',
            ESTADO_CLASSE[info.estado],
          )}
        >
          {ESTADO_LABEL[info.estado]}
        </span>
        {info.motivo !== null ? <span className="text-slate-500">{info.motivo}</span> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        {isModoLocal ? null : ativa ? (
          <button
            type="button"
            onClick={desconectar}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            <Unplug className="h-4 w-4" aria-hidden />
            Desconectar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void autorizar()}
            disabled={autorizando}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {autorizando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            )}
            Autorizar planilha de cotações
          </button>
        )}
      </div>

      {isModoLocal ? (
        <p className="text-xs text-slate-500">
          A planilha de cotações precisa de uma sessão Google. Volte para o modo Google para
          autorizá-la.
        </p>
      ) : null}

      {aviso !== null ? <Alert variant="info">{aviso}</Alert> : null}
      {erro !== null ? <Alert variant="error">{erro}</Alert> : null}
    </div>
  )
}
