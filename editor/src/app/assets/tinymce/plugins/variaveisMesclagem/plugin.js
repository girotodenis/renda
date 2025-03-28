tinymce.PluginManager.add('a4pages', function (editor, url) {
  // Adiciona um botão à barra de ferramentas
  editor.ui.registry.addButton('add_page', {
    text: 'Adicionar Página',
    onAction: function () {
      const container = editor.getContainer().querySelector('.a4-container');
      if (container) {
        const newPage = document.createElement('div');
        newPage.className = 'a4-page';
        container.appendChild(newPage);
      }
    }
  });

  // Resto do código do plugin (como antes)
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

  editor.on('input', function () {
    const container = editor.getContainer().querySelector('.a4-container');
    if (!container) return;

    const pages = container.querySelectorAll('.a4-page');

    pages.forEach(page => {
      if (page.scrollHeight > page.offsetHeight) {
        const newPage = document.createElement('div');
        newPage.className = 'a4-page';
        container.appendChild(newPage);
      }
    });
  });

  return {};
});
