/**
 * Declarações ambientes mínimas das bibliotecas do Google usadas pelo app:
 * Google Identity Services (GIS), Google API Loader (`gapi`) e Google Picker.
 *
 * Mantidas aqui para evitar `any` e dar tipagem estrita ao `window.google`.
 */

export {}

declare global {
  interface GoogleTokenResponse {
    access_token: string
    expires_in?: number
    scope: string
    token_type: string
    error?: string
    error_description?: string
  }

  interface GoogleTokenError {
    type: string
    message?: string
  }

  interface GoogleTokenClientConfig {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
    error_callback?: (error: GoogleTokenError) => void
    prompt?: string
    enable_granular_consent?: boolean
  }

  interface GoogleTokenClient {
    requestAccessToken: (overrides?: { prompt?: string }) => void
  }

  interface GoogleOAuth2 {
    initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient
    revoke: (accessToken: string, done?: () => void) => void
  }

  interface GoogleAccounts {
    oauth2: GoogleOAuth2
  }

  interface GapiLoadConfig {
    callback: () => void
    onerror: () => void
    timeout?: number
    ontimeout?: () => void
  }

  interface Gapi {
    load: (library: string, config: GapiLoadConfig) => void
  }

  interface GooglePickerDocument {
    id: string
    name: string
    mimeType: string
    url?: string
  }

  interface GooglePickerData {
    action?: string
    docs?: GooglePickerDocument[]
  }

  interface GooglePickerDocsView {
    setIncludeFolders: (value: boolean) => GooglePickerDocsView
    setSelectFolderEnabled: (value: boolean) => GooglePickerDocsView
    setMimeTypes: (mimeTypes: string) => GooglePickerDocsView
    setMode: (mode: string) => GooglePickerDocsView
    setParent: (parentId: string) => GooglePickerDocsView
  }

  interface GooglePickerBuilder {
    addView: (view: GooglePickerDocsView) => GooglePickerBuilder
    setOAuthToken: (token: string) => GooglePickerBuilder
    setDeveloperKey: (key: string) => GooglePickerBuilder
    setAppId: (appId: string) => GooglePickerBuilder
    setTitle: (title: string) => GooglePickerBuilder
    setLocale: (locale: string) => GooglePickerBuilder
    setCallback: (callback: (data: GooglePickerData) => void) => GooglePickerBuilder
    enableFeature: (feature: string) => GooglePickerBuilder
    build: () => GooglePickerInstance
  }

  interface GooglePickerInstance {
    setVisible: (visible: boolean) => void
  }

  interface GooglePickerApi {
    PickerBuilder: new () => GooglePickerBuilder
    DocsView: new (viewId?: string) => GooglePickerDocsView
    ViewId: { SPREADSHEETS: string; DOCS: string }
    Action: { PICKED: string; CANCEL: string }
    Response: { ACTION: string; DOCUMENTS: string }
    Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string }
  }

  interface GoogleNamespace {
    accounts: GoogleAccounts
    picker: GooglePickerApi
  }

  interface Window {
    google?: GoogleNamespace
    gapi?: Gapi
  }
}
