import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SkinLoadedService {

  constructor() { }

  load(editor:any){
    console.log('Skin carregada com sucesso!');
    const iframe = editor.getDoc();

    editor.on('init', function () {
      if (editor.getContent({ format: 'raw' }).trim() === ''||editor.getContent({ format: 'raw' }).trim() === '<p><br data-mce-bogus="1"></p>') {
        editor.setContent('<div class="a4-container"  style="min-height:277mm;width: 190mm;border: 0px solid #000;"><p></p></div>');
      }
    });

    editor.on('input', function () {
      if (editor.getContent({ format: 'raw' }).trim() === '' ||editor.getContent({ format: 'raw' }).trim() === '<p><br data-mce-bogus="1"></p>') {
        editor.setContent('<div class="a4-container"  style="min-height:277mm;width: 190mm;border: 0px solid #000;"><p></p></div>');
      }
    });

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
