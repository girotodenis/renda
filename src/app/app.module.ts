import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';


import { LoginModule } from './autenticacao/login/login.module'
//import { LoginRoutingModule } from './autenticacao/login/login-routing.module';
import { RendaModule } from './uc/renda/renda.module'
import { RendaRoutingModule } from './uc/renda/renda-routing.module';


/**template*/
import { HeaderComponent } from './components/template/header/header.component'
import { FooterComponent } from './components/template/footer/footer.component';
import { MenuComponent } from './components/template/menu/menu.component';
import { ContentComponent } from './components/template/content/content.component';
import { SettingComponent } from './components/template/setting/setting.component';
/**template*/

/**PRIMENG*/
import {ToolbarModule} from 'primeng/toolbar';
import {ButtonModule} from 'primeng/button';
import {SplitButtonModule} from 'primeng/splitbutton';
/**PRIMENG*/

@NgModule({
  declarations: [
    AppComponent,
    HeaderComponent,
    FooterComponent,
    MenuComponent,
    ContentComponent,
    SettingComponent

  ],
  imports: [
    BrowserModule,
    
    ToolbarModule,
    ButtonModule,
    SplitButtonModule,
    
    LoginModule,
    //LoginRoutingModule,
    RendaModule,
    RendaRoutingModule,

    //modulo raiz deve ser o ultimo
    AppRoutingModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
