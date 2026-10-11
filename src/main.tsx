import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from '@/presentation/app/App'
import { ensureHydrated } from '@/infrastructure/kvStore'
import '@/index.css'

// Service worker apenas em build de produção (em dev o `virtual:pwa-register`
// vira um no-op — `devOptions.enabled: false` no vite.config.ts).
// `autoUpdate`: atualiza em segundo plano sem prompt obrigatório nesta fase.
registerSW({ immediate: true })

/**
 * Bootstrap do app.
 *
 * Antes de renderizar, hidrata o espelho em memória (Fase 5) lendo o cache de
 * abas e o outbox do IndexedDB. A hidratação nunca impede o render: em caso de
 * falha, seguimos com o espelho vazio (o app funciona com cache frio).
 */
async function bootstrap(): Promise<void> {
  try {
    await ensureHydrated()
  } catch {
    // Falha de hidratação: segue com o espelho vazio — nunca bloqueia o render.
  }

  const rootElement = document.getElementById('root')

  if (!rootElement) {
    throw new Error('Elemento #root não encontrado no index.html')
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
