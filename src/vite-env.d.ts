/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Client ID do OAuth 2.0 (Google Identity Services). Obrigatório para login. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Chave de API do Google Picker. Opcional (apenas seleção de planilha existente). */
  readonly VITE_GOOGLE_PICKER_API_KEY?: string
  /** Número do projeto Google Cloud (appId do Picker). Opcional. */
  readonly VITE_GOOGLE_PROJECT_NUMBER?: string
  /** Token da API Brapi.dev (fallback de cotação B3). Opcional. */
  readonly VITE_BRAPI_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
