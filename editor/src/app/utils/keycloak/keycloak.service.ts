import { Injectable } from '@angular/core';
import  Keycloak from 'keycloak-js';

@Injectable({
  providedIn: 'root'
})
export class KeycloakService {

  private _keycloak: Keycloak | undefined;

  constructor() { }

  get keycloak(): Keycloak {
    if (!this._keycloak) {
      this._keycloak = new Keycloak({
        url: 'http://localhost:8081',
        realm: 'sistemas',
        clientId: 'editor-client',
      });
    }
    return this._keycloak;
  }

  async init(){
    const authenticated:boolean = await this.keycloak.init({
      onLoad: 'login-required',
      checkLoginIframe: false,
    });
  }


  async login(){
    this.keycloak.login();
  }

  get userId(): string {
    return this.keycloak?.tokenParsed?.sub as string;
  }

  get isTokenValid(): boolean {
    return !this.keycloak.isTokenExpired();
  }

  get userName(): string {
    return this.keycloak?.tokenParsed?.['preferred_username'] as string;
  }

  logout(){
    this.keycloak.logout();
  }

  accountManagement(){
    return this.keycloak.accountManagement();
  }

}
