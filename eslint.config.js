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
    },
  },
  {
    // Caminhos legados que agora são apenas re-exports (shims) apontando para as
    // camadas `src/presentation/**`. O `export *` não é verificável pela regra
    // de fast-refresh, mas aqui ele é intencional.
    files: ['src/features/**/*.tsx', 'src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
