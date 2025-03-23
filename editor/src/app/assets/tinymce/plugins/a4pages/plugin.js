tinymce.PluginManager.add('a4pages', function (editor, url) {
  //Adiciona os estilos ao conteúdo do editor
  editor.on('init', function () {
      // Verifica se o editor está vazio
      if (editor.getContent({ format: 'raw' }).trim() === ''||editor.getContent({ format: 'raw' }).trim() === '<p><br data-mce-bogus="1"></p>') {
        // editor.setContent('<div class="a4-container"> <div class="a4-page" style="min-height:277mm;width: 190mm;border: 0px solid #000;"><p></p></div> </div>');
      }
  });

  // Lógica de monitoramento para adicionar novas folhas
  editor.on('input', function (data) {

    // if (editor.getContent({ format: 'raw' }).trim() === '' ||editor.getContent({ format: 'raw' }).trim() === '<p><br data-mce-bogus="1"></p>') {
    //   // Define o conteúdo padrão
    //   editor.setContent('<div class="a4-container"> <div class="a4-page" style="min-height:277mm;width: 190mm;border: 0px solid #000;"><p></p></div></div>');
    // }

    // console.log("input",data.target.innerHTML);
    const container = editor.dom.select('.a4-container')[0];
    const pages = editor.dom.select('.a4-page');
    let [fim] = [...pages].reverse();;
    pages.forEach(page => {
      if(fim.innerHTML === page.innerHTML){
          if (page.scrollHeight > 1048) {
            console.log("page.scrollHeight ", page.scrollHeight);
            console.log("page.offsetHeight ", page.offsetHeight);
            editor.insertContent('<hr>');
            // container.innerHTML = '<div class="a4-page" style="min-height:277mm;width: 190mm;border: 0px solid #000;"><p></p></div>';
            editor.insertContent('<div class="a4-page" style="min-height:277mm;width: 190mm;border: 0px solid #000;"><p></p></div>');
          }
        }
    });
  });

});
