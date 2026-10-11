import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Blindagem da regra de dependência: fora das pastas legadas (shims),
      // ninguém pode importar pelos caminhos antigos — apenas pelos canônicos
      // `@/domain`, `@/application`, `@/infrastructure`, `@/presentation`.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/lib/**'], message: 'Use os caminhos canônicos (`@/domain/*`, `@/infrastructure/*`).' },
            { group: ['@/services/**'], message: 'Use os caminhos canônicos (`@/application/*`, `@/infrastructure/*`).' },
            { group: ['@/types/**'], message: 'Use os caminhos canônicos (`@/domain/*`).' },
            { group: ['@/features/**'], message: 'Use `@/presentation/features/*`.' },
            { group: ['@/components/**'], message: 'Use `@/presentation/components/*`.' },
            { group: ['@/hooks/**'], message: 'Use `@/presentation/hooks/*`.' },
            { group: ['@/app/**'], message: 'Use `@/presentation/app/*`.' },
          ],
        },
      ],
    },
  },
)
