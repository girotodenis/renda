import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Domínios de terceiros/autenticados que NUNCA devem entrar no precache nem numa
 * rota de runtime caching do service worker:
 * - `accounts.google.com` / `apis.google.com`: Google Identity Services (GIS)
 * - `sheets.googleapis.com` / `www.googleapis.com`: Google Sheets/Drive API
 *
 * Requisições a esses hosts contêm (ou dependem de) credenciais do usuário, então
 * devem sempre ir à rede. Sem regra de cache, o Workbox as deixa passar sem interceptar.
 */
const GOOGLE_ORIGINS_REGEX = /^https:\/\/(?:accounts|apis|sheets|www)\.google(?:apis)?\.com\/.*/i

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `autoUpdate`: o SW novo assume o controle e recarrega sem prompt obrigatório.
      registerType: 'autoUpdate',
      // O registro é feito manualmente em `src/main.tsx` via `virtual:pwa-register`.
      injectRegister: false,
      manifest: {
        name: 'Minhas Ações',
        short_name: 'Minhas Ações',
        description: 'Controle de investimentos e rebalanceamento de carteira.',
        lang: 'pt-BR',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell: JS/CSS/HTML e assets locais.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA: qualquer navegação sem arquivo correspondente cai no index.html.
        navigateFallback: '/index.html',
        // Rede de segurança: navegações para os domínios do Google nunca usam o fallback.
        navigateFallbackDenylist: [GOOGLE_ORIGINS_REGEX],
        // Explicita que os domínios do Google não são cacheados (sempre rede).
        runtimeCaching: [
          {
            urlPattern: GOOGLE_ORIGINS_REGEX,
            handler: 'NetworkOnly',
          },
        ],
      },
      // Somente build de produção gera/habilita o service worker.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
