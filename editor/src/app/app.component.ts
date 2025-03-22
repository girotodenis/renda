import { Component } from '@angular/core';
import { EditorComponent } from '@tinymce/tinymce-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EditorComponent],
  template: `
  <h1>TinyMCE 7 Angular Demo</h1>
  <editor
    [init]="init"
  />
  `
})
export class AppComponent {
  init: EditorComponent['init'] = {
    base_url: '/tinymce', // Root for resources
    skin: 'tinymce-5',
    license_key: 'gpl',
    suffix: '.min'  ,
    min_height: 500,
    language: 'pt_BR',
    contextmenu: 'bold italic underline',
    autoresize_min_height: 650,
    pagebreak_split_block: true,
    menubar: true,
    //  toc lineheight print hr paste textcolor colorpicker textpattern imagetools
    plugins: 'variaveisMesclagem fullscreen codesample insertdatetime advlist media lists autoresize save searchreplace nonbreaking link image charmap preview anchor pagebreak visualblocks visualchars code table directionality help',
    external_plugins: {
      variaveisMesclagem: 'plugins/variaveisMesclagem/plugin.js'
    },
    toolbar: `showVariable | undo redo | fontselect | fontsizeselect | styleselect | bold italic underline forecolor backcolor` +
    ` | link image | alignleft aligncenter alignright alignjustify | numlist bullist outdent indent` +
    ` | removeformat | lineheightselect`,
  };
}