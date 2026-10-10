import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Configuração dos testes unitários (Vitest).
 *
 * Os módulos testados aqui são puros (sem DOM/rede): o ambiente `node` basta.
 * O alias `@` espelha o `resolve.alias` do `vite.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
