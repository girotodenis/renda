import { Component, NgZone, OnInit } from '@angular/core';
import { EditorComponent } from '@tinymce/tinymce-angular';
import { EditorService } from './utils/tinymce/editor.service';
import { SkinLoadedService } from './utils/tinymce/skin-loaded.service';
import { ModalModelosComponent } from './components/modal-modelos/modal-modelos.component';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EditorComponent, ModalModelosComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  idEditor = 'idEditor';
  nome = 'nome_arquivo';

  constructor(
    private editorService: EditorService,
    private skinLoadedService: SkinLoadedService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {

    this.editorService.onEditorEventAssinc('nome_arquivo', (event) => {
      console.log('nome_arquivo: ', event);
      this.ngZone.run(() => {
        this.nome = event;
        console.log('nome_arquivo: ',  this.nome);
      });
    });

    this.editorService.onEditorEventAssinc('atualizar_content', (event, editor) => {
      console.log('atualizar_content: ', event);
      editor.setContent(event);
      if(event.includes(`class="a4-container"`)) {
        editor.setContent(event);
      }else{
        editor.setContent(`<div class="a4-container" style="width: 190mm;min-height:277mm;border: 0px solid #000;">${event}</div>`);
      }
      // editor.setContent(event);
    });

  }


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
    menu: {
      file: { title: 'File', items: 'item_modelos' }
    },
    menubar: true,
    extended_valid_elements: 'span[class|data-var|style]', // Permitir atributos personalizados
    valid_children: '+body[style],+body[span]', // Permitir spans e estilos no body
    forced_root_block: 'p', // Garante que o conteúdo fique dentro de tags <p>
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
        editor.setContent(`<div class="a4-container" style="width: 190mm;min-height:277mm;border: 0px solid #000;"></div>`);
      });

    },
  };
}
