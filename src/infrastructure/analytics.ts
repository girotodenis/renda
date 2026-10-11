/**
 * Inicialização do Google Analytics 4 (GA4).
 *
 * O Measurement ID vem de `VITE_GA_MEASUREMENT_ID` (opcional). Quando a variável
 * está ausente/vazia, o script do gtag NÃO é carregado e o app segue funcionando
 * normalmente, sem nenhuma telemetria.
 */

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

function readTrimmed(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Carrega o `gtag.js` e registra o `page_view` inicial.
 * É seguro chamar mesmo sem a variável configurada (no-op).
 */
export function initAnalytics(): void {
  const measurementId = readTrimmed(GA_MEASUREMENT_ID)
  if (!measurementId) return

  window.dataLayer = window.dataLayer ?? []
  window.gtag =
    window.gtag ??
    function gtag(...args: unknown[]) {
      window.dataLayer?.push(args)
    }

  window.gtag('js', new Date())
  window.gtag('config', measurementId)

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
  document.head.appendChild(script)
}
