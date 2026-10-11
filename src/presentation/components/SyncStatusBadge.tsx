import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { cn } from '@/presentation/cn'
import type { SyncPhase } from '@/presentation/hooks/useSync'

/**
 * Badge de estado da sincronização (Fase 4 do plano PWA).
 *
 * Complementa (sem duplicar) o banner "Modo offline" do `AppLayout`:
 * - offline → badge "Offline" (com o contador de pendências, se houver);
 * - online com pendências → "N alterações pendentes" + botão "Sincronizar agora";
 * - erro → alerta discreto (`AlertTriangle`), sem travar a UI;
 * - online sem pendências → sem badge (ou "Sincronizado", discreto, após aplicar).
 *
 * É um componente de apresentação puro: recebe todo o estado por props e apenas
 * dispara `onSync` — nenhuma lógica de sincronização vive aqui.
 */

export interface SyncStatusBadgeProps {
  /** Estado de conexão do navegador. */
  online: boolean
  /** Quantidade de alterações pendentes na fila offline. */
  pendentes: number
  /** Fase do último ciclo de sincronização. */
  status: SyncPhase
  /** Quantas mutações o último ciclo aplicou (habilita o "ok" discreto). */
  aplicadas?: number
  /** Mensagem de erro do último ciclo, se houver. */
  erro?: string
  /** Ação do botão "Sincronizar agora". */
  onSync: () => void
  /** Classes extras (posicionamento no layout). */
  className?: string
}

const badgeClass = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium'

function rotuloPendencias(total: number): string {
  return total === 1 ? '1 alteração pendente' : `${total} alterações pendentes`
}

/** Botão de flush manual, reutilizado nos estados de pendência e de erro. */
function SyncButton({ sincronizando, onClick }: { sincronizando: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sincronizando}
      className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 font-semibold ring-1 ring-inset ring-black/5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {sincronizando ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-3 w-3" aria-hidden />
      )}
      Sincronizar agora
    </button>
  )
}

export function SyncStatusBadge({
  online,
  pendentes,
  status,
  aplicadas = 0,
  erro,
  onSync,
  className,
}: SyncStatusBadgeProps) {
  const sincronizando = status === 'syncing'
  const temPendencias = pendentes > 0
  const temErro = status === 'error' || Boolean(erro)

  // Offline: o flush só ocorre ao reconectar — mostra o contador, sem botão.
  if (!online) {
    return (
      <span
        role="status"
        title="Sem conexão — as alterações serão sincronizadas ao reconectar."
        className={cn(badgeClass, 'border-amber-200 bg-amber-50 text-amber-800', className)}
      >
        <WifiOff className="h-3.5 w-3.5" aria-hidden />
        <span>Offline</span>
        {temPendencias ? <span className="text-amber-700">· {rotuloPendencias(pendentes)}</span> : null}
      </span>
    )
  }

  // Erro (não bloqueante): alerta discreto + retry manual.
  if (temErro && !sincronizando) {
    return (
      <span
        role="status"
        title={erro ?? 'Falha ao sincronizar as alterações pendentes.'}
        className={cn(badgeClass, 'border-red-200 bg-red-50 text-red-700', className)}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        <span>Falha ao sincronizar</span>
        {temPendencias ? <span className="text-red-600">· {rotuloPendencias(pendentes)}</span> : null}
        <SyncButton sincronizando={false} onClick={onSync} />
      </span>
    )
  }

  // Online com pendências (ou ciclo em andamento): contador + botão.
  if (temPendencias || sincronizando) {
    return (
      <span role="status" className={cn(badgeClass, 'border-sky-200 bg-sky-50 text-sky-700', className)}>
        {sincronizando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        )}
        <span>{temPendencias ? rotuloPendencias(pendentes) : 'Sincronizando…'}</span>
        <SyncButton sincronizando={sincronizando} onClick={onSync} />
      </span>
    )
  }

  // Online, sem pendências: "Sincronizado" discreto apenas quando algo foi
  // efetivamente aplicado neste ciclo; caso contrário, nenhum badge.
  if (status === 'ok' && aplicadas > 0) {
    return (
      <span
        role="status"
        className={cn(badgeClass, 'border-emerald-200 bg-emerald-50 text-emerald-700', className)}
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        <span>Sincronizado</span>
      </span>
    )
  }

  return null
}
