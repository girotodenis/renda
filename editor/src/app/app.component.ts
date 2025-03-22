import { Component } from '@angular/core';
import { EditorComponent } from '@tinymce/tinymce-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EditorComponent],
  template: `
  <div style="width: 100%; background-color: blue;"><span style="padding-left: 10px;color: #fff;">{{[nome]}}</span></div>
  <div class="my-custom-editor-container">
    <editor
      [id]="idEditor"
      [init]="init"
    />
  </div>
  `
})
export class AppComponent {
  idEditor = 'idEditor';
  nome = 'nome_arquivo';

  init: EditorComponent['init'] = {
    base_url: '/tinymce', // Root for resources
    selector:'#idEditor',
    // skin: 'fabric', // Nome da skin
    // content_css: '/tinymce/skins/ui/fabric/content.css', // Caminho para o arquivo de estilos do conteúdo
    // skin_url: '/tinymce/skins/ui/fabric', // Caminho para a pasta da skin
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
      console.log('TinyMCE inicializado com skin: fabric');
      editor.on('SkinLoaded', () => {
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
      });
    },
  };
}
