import { HttpHeaders, HttpInterceptorFn } from '@angular/common/http';
import { KeycloakService } from '../keycloak/keycloak.service';
import { inject } from '@angular/core';

export const keycloakHttpInterceptor: HttpInterceptorFn = (req, next) => {

  const keycloakService: KeycloakService = inject(KeycloakService);
  const token:any = keycloakService.keycloak.token;
  if(token){
    const authReq = req.clone({
      //headers: req.headers.set('Authorization', `Bearer ${token}`)
      headers: new HttpHeaders({
        'Authorization': `Bearer ${token}`
      })
    });
    return next(authReq);
  }
  return next(req);
};
