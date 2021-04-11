import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LoginComponent } from './components/login/login.component'; 
//import { LogarComponent } from './components/logar.component';

export const LoginRoutes: Routes = [
  //{
  //    path: 'login', 
  //    component: LogarComponent, 
  //    children: [{path: '', component: LoginComponent}]
  //}
];

@NgModule({
  imports: [RouterModule.forRoot(LoginRoutes)],
  exports: [RouterModule]
})
export class LoginRoutingModule {
}
