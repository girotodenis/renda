export const environment = {
  production: true,
  keycloak: {
    enable: true, // Habilitar ou desabilitar o Keycloak para o aplicativo frontend
    authority: 'http://localhost:8081', // URL do Keycloak
    redirectUri: 'http://localhost:4200', // URL do aplicativo frontend
    postLogoutRedirectUri: 'http://localhost:4200/logout', // Valor opcional
    realm: 'sistemas', // Nome do Realm
    clientId: 'editor-client',
  },
};
