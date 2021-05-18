import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';


import { LoginComponent } from './components/login/login.component';
//import { LogarComponent } from './components/logar.component';

import {ButtonModule} from 'primeng/button';
import {AvatarModule} from 'primeng/avatar';
import {AvatarGroupModule} from 'primeng/avatargroup';

import { SocialLoginModule, SocialAuthServiceConfig } from 'angularx-social-login';
import { GoogleLoginProvider } from 'angularx-social-login';

@NgModule({
  declarations: [
    LoginComponent//,
    //LogarComponent
  ],
  imports: [
    CommonModule,
    //RouterModule,
    
    SocialLoginModule,
    ButtonModule,
    AvatarModule,
    AvatarGroupModule
  ],
  exports: [
    LoginComponent
  ],
  providers: [
    {
      provide: 'SocialAuthServiceConfig',
      useValue: {
        autoLogin: false,
        providers: [
          {
            id: GoogleLoginProvider.PROVIDER_ID,
            provider: new GoogleLoginProvider(
              '550020476022-e5t475bmbd1bls0d9838hngioj3t71d4.apps.googleusercontent.com'
            )
          }
        ]
      } as SocialAuthServiceConfig,
    }    
  ],
})
export class LoginModule { }

