import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from '@/app/App'
import '@/index.css'

// Service worker apenas em build de produção (em dev o `virtual:pwa-register`
// vira um no-op — `devOptions.enabled: false` no vite.config.ts).
// `autoUpdate`: atualiza em segundo plano sem prompt obrigatório nesta fase.
registerSW({ immediate: true })

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Elemento #root não encontrado no index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
