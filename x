//editor/src/app/utils/tinymce/editor.service.ts
import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EditorService {

  private editorInstance: any; // Referência ao editor TinyMCE

  // Método para inicializar o editor (chamado no setup do TinyMCE)
  setEditorInstance(editor: any) {
    this.editorInstance = editor;
  }

  // Método para disparar eventos no editor
  fireEvent(eventName: string, data: any) {
    if (this.editorInstance) {
      console.info('fireEvent: ', eventName);
      this.editorInstance.fire(eventName, { data });
    } else {
      console.error('Editor instance is not initialized yet.');
    }
  }

  // Método para a escutar eventos
  onEditorEvent(eventName: string, callback: (eventData: any, editor: any) => void ): void {
    this.editorInstance.on(eventName, (event: any) => {
      console.log('listerne :', eventName);
      callback(event.data, this.editorInstance);
    });
  }

}

//editor/src/app/utils/tinymce/skin-loaded.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SkinLoadedService {

  constructor() { }

  load(editor:any){
    console.log('Skin carregada com sucesso!');
    const iframe = editor.getDoc();

    if (iframe) {
      const body = iframe.body;
      // Ajusta os estilos do body
      const applyStyles = () => {
        body.style.paddingLeft = '10mm';
        body.style.paddingRight = '20mm';
        body.style.minHeight = '100%';
        body.style.overflowY = 'auto';
      };
      // Aplica os estilos iniciais
      applyStyles();
      // Observa mudanças no atributo `style`
      const observer = new MutationObserver(() => {
        applyStyles(); // Reaplica os estilos sempre que o atributo `style` muda
      });
      observer.observe(body, { attributes: true, attributeFilter: ['style'] });
    }
  }

}



//editor/src/app/utils/keycloak/keycloak.service.ts
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

//editor/src/app/utils/http/keycloak-http.interceptor.ts
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


//editor/src/app/app.component.css

//editor/src/app/app.component.html
<div style="width: 100%; background-color: blue;"><span style="padding-left: 10px;color: #fff;">{{[nome]}}</span></div>
<div class="my-custom-editor-container">
  <editor
    [id]="idEditor"
    [init]="init"
  />
</div>


//editor/src/app/app.component.ts
import { Component } from '@angular/core';
import { EditorComponent } from '@tinymce/tinymce-angular';
import { EditorService } from './utils/tinymce/editor.service';
import { SkinLoadedService } from './utils/tinymce/skin-loaded.service';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EditorComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  idEditor = 'idEditor';
  nome = 'nome_arquivo';

  constructor(
    private editorService: EditorService,
    private skinLoadedService: SkinLoadedService
  ) {}

  init: EditorComponent['init'] = {
    base_url: '/tinymce', // Root for resources
    selector:'#idEditor',
    skin: 'fabric', // Nome da skin
    content_css: '/tinymce/skins/ui/fabric/content.css', // Caminho para o arquivo de estilos do conteúdo
    skin_url: '/tinymce/skins/ui/fabric', // Caminho para a pasta da skin
    // toolbar_mode: 'floating',
    license_key: 'gpl',  // Concorda com os termos da licença GPL
    suffix: '.min'  ,
    language: 'pt_BR',
    language_url: '/tinymce/langs/pt_BR.js',
    contextmenu: 'bold italic underline',
    min_height: 500,
    // autoresize_min_height: 650,
    // pagebreak_split_block: true,
    //  toc lineheight print hr paste textcolor colorpicker textpattern imagetools
    menubar: true,
  //font_size_formats: '10px 12px 13px 14px 16px 18px 24px 32px 48px 96px', // Define os tamanhos em px
    font_size_formats: '8pt 9pt 10pt 11pt 12pt 14pt 18pt 24pt 36pt 72pt', // Define os tamanhos em px
    plugins: 'variaveisMesclagem fullscreen codesample insertdatetime advlist media lists autoresize save searchreplace nonbreaking link image charmap preview anchor pagebreak visualblocks visualchars code table directionality help',
    external_plugins: {
      variaveisMesclagem: 'plugins/variaveisMesclagem/plugin.js'
    },
    toolbar: `showVariable | undo redo | fontselect | fontsizeselect | styleselect | bold italic underline forecolor backcolor` +
    ` | link image | alignleft aligncenter alignright alignjustify | numlist bullist outdent indent` +
    ` | removeformat | lineheightselect`,
    setup: (editor) => {

      // Registrar a instância do editor no serviço
      this.editorService.setEditorInstance(editor);

      this.editorService.onEditorEvent('SkinLoaded', (data, meuditor) => {
        console.log('TinyMCE inicializado com skin: fabric');
        this.skinLoadedService.load(meuditor);
      });

    },
  };
}


//editor/src/app/app.config.ts
import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { KeycloakService } from './utils/keycloak/keycloak.service';
import { keycloakHttpInterceptor } from './utils/http/keycloak-http.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([keycloakHttpInterceptor])
    ),
    provideAppInitializer(()=>{
      const initFn = ((key: KeycloakService) =>{
        return () => key.init();
      })(inject(KeycloakService));
      return initFn();
    }),
  ]
};


//editor/src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [];


//editor/src/index.html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Editor</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <script src="tinymce/tinymce.min.js"></script>
</head>
<body>
  <app-root></app-root>
</body>
</html>


//editor/src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));



//editor/angular.json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "newProjectRoot": "projects",
  "projects": {
    "editor": {
      "projectType": "application",
      "schematics": {},
      "root": "",
      "sourceRoot": "src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:application",
          "options": {
            "outputPath": "dist/editor",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "polyfills": [
              "zone.js"
            ],
            "tsConfig": "tsconfig.app.json",
            "assets": [
              { "glob": "**/*", "input": "public"  },
              { "glob": "**/*", "input": "node_modules/tinymce", "output": "/tinymce/" },
              { "glob": "**/*", "input": "src/app/assets/tinymce/langs", "output": "/tinymce/langs" },
              { "glob": "**/*", "input": "src/app/assets/tinymce/plugins/variaveisMesclagem", "output": "/tinymce/plugins/variaveisMesclagem"  },
              { "glob": "**/*", "input": "src/app/assets/tinymce/skins/ui/fabric", "output": "/tinymce/skins/ui/fabric"  }
            ],
            "styles": [
              "src/styles.css"
            ],
            "scripts": [
              "node_modules/tinymce/tinymce.min.js"
            ]
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "500kB",
                  "maximumError": "1MB"
                },
                {
                  "type": "anyComponentStyle",
                  "maximumWarning": "4kB",
                  "maximumError": "8kB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular-devkit/build-angular:dev-server",
          "options": {"port": 8082},
          "configurations": {
            "production": {
              "buildTarget": "editor:build:production"
            },
            "development": {
              "buildTarget": "editor:build:development"
            }
          },
          "defaultConfiguration": "development"
        },
        "extract-i18n": {
          "builder": "@angular-devkit/build-angular:extract-i18n"
        },
        "test": {
          "builder": "@angular-devkit/build-angular:karma",
          "options": {
            "polyfills": [
              "zone.js",
              "zone.js/testing"
            ],
            "tsConfig": "tsconfig.spec.json",
            "assets": [
              { "glob": "**/*", "input": "public" },
              { "glob": "**/*", "input": "node_modules/tinymce", "output": "/tinymce/" },
              { "glob": "**/*", "input": "src/app/assets/tinymce/langs", "output": "/tinymce/langs" },
              { "glob": "**/*", "input": "src/app/assets/tinymce/plugins/variaveisMesclagem", "output": "/tinymce/plugins/variaveisMesclagem"  },
              { "glob": "**/*", "input": "src/app/assets/tinymce/skins/ui/fabric", "output": "/tinymce/skins/ui/fabric"  }
            ],
            "styles": [
              "src/styles.css"
            ],
            "scripts": []
          }
        }
      }
    }
  },
  "cli": {
    "analytics": "89fd5277-27d3-40a2-b9e4-6a739c0f1d74"
  }
}
