tinymce.PluginManager.add('a4pages', function (editor, url) {
  // Adiciona os estilos ao conteúdo do editor
  editor.on('init', function () {
    const style = `
      .a4-container {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .a4-page {
        width: 210mm;
        height: 297mm;
        border: 1px solid #000;
        margin: 10px auto;
        padding: 20mm;
        box-sizing: border-box;
        overflow: hidden;
      }
    `;
    editor.contentStyles.push(style);

    if (!editor.getContent()) {
      editor.setContent('<div class="a4-container"><div class="a4-page"></div></div>');
    }
  });

  // Lógica de monitoramento para adicionar novas folhas
  editor.on('input', function () {
    const container = editor.getContainer().querySelector('.a4-container');
    if (!container) return;

    const pages = container.querySelectorAll('.a4-page');

    pages.forEach(page => {
      // Verifica se o conteúdo ultrapassou o tamanho da folha
      if (page.scrollHeight > page.offsetHeight) {
        // Adiciona uma nova folha
        const newPage = document.createElement('div');
        newPage.className = 'a4-page';
        container.appendChild(newPage);
      }
    });
  });

  return {};
});
