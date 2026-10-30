/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Client ID do OAuth 2.0 (Google Identity Services). Obrigatório para login. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Chave de API do Google Picker. Opcional (apenas seleção de planilha existente). */
  readonly VITE_GOOGLE_PICKER_API_KEY?: string
  /** Número do projeto Google Cloud (appId do Picker). Opcional. */
  readonly VITE_GOOGLE_PROJECT_NUMBER?: string
  /** Backend do modo Google: 'sheets' (padrão) ou 'json' (arquivo JSON no Drive). */
  readonly VITE_GOOGLE_BACKEND?: string
  /** Measurement ID do Google Analytics 4 (ex.: G-XXXXXXX). Opcional. */
  readonly VITE_GA_MEASUREMENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
