tinymce.PluginManager.add('variaveisMesclagem', function (editor) {

  var showVariable = false; // Valor inicial do botão

  let variables = {
    'teste.nome': 'teste.nome',
    'teste.email': 'teste.email'
  };

  editor.on('loadVariables', function (event) {
    console.warn('editor.loadVariables', event);
    console.warn('editor.loadVariables', event.data);
    variables = event.data;
    if (showVariable) {
      resolverSpansDoTemplate();
    }
  });

  editor.on('loadContent', function (data) {
    console.warn('editor.loadContent');
    if (showVariable) {
      resolverSpansDoTemplate();
    }
  });

  editor.ui.registry.addMenuItem('item_modelos', {
    text: 'Abrir Modelos',
    onAction: () => editor.fire('evento_abrir_modelos', "abrir")
  });

  editor.ui.registry.addButton('showVariable', {
    text: '< - >',
    onAction: function (botao) {
      showVariable = !showVariable; // Alterna o valor do botão

      botao.setText(showVariable ? '<o>' : '< - >'); // Alterna o texto do botão

      resolverSpansDoTemplate();
    }
  });

  let resolverSpansDoTemplate = () => {
    // Seleciona todos os elementos que possuem o atributo data-var
    let elements = editor.dom.select('[data-var]');
    elements.forEach(function (element) {
      // Pega o valor do atributo data-var
      let variableName = element.getAttribute('data-var');
      if (variableName) {
        // Se o botão estiver em 'show', mostrar o valor da variável
        if (showVariable) {
          if(variables[variableName]){
            element.innerHTML = variables[variableName];
            editor.dom.removeClass(element, 'variaveisMesclagem');
            element.removeAttribute('style');
            //remover variavel variaveisMesclagem
          }else{
            element.innerText = '@'+variableName;
            element.style = 'color: navy; font-style: italic;';
          }
          // element.innerHTML = '';
          // element.innerText = '';
          // var meuSpan = editor.dom.create('span');
          // meuSpan.textContent = variables[variableName] || variableName; // Exibe o valor ou a chave caso o valor não exista
          // element.appendChild(meuSpan);
          // editor.dom.addClass(element, 'valorMesclado');
        }
        // Se o botão estiver em 'hide', mostrar o nome da variável
        else {
          element.innerHTML = '';
          element.innerText = '@' + variableName;
          editor.dom.addClass(element, 'variaveisMesclagem');
          element.style = 'color: navy; font-style: italic;';
          //adicionar classe  variaveisMesclagem no elemento
          // var meuSpan = editor.dom.create('span');
          // meuSpan.textContent = '@' + variableName;
          // meuSpan.style.color = 'navy';
          // meuSpan.style.fontStyle = 'italic';
          // element.appendChild(meuSpan);
          // editor.dom.removeClass(element, 'valorMesclado');
        }
      }
    });
  };

  editor.ui.registry.addAutocompleter('variables', {
    ch: '@',
    minChars: 0,
    columns: 1,
    fetch: function (pattern) {

      let matchedVariables = Object.keys(variables).filter(item => item.includes(pattern));
      return new Promise(function (resolve) {
        resolve(matchedVariables.map(function (item) {
          return {
            value: `<span data-var="${item}" class="variaveisMesclagem" style="color: navy; font-style: italic;">@${item}</span>&nbsp;`,
            text: item + ' = ' + variables[item],
            icon: '@'
          };
        }));
      });
    },
    onAction: function (autocompleteApi, rng, value) {
      editor.selection.setRng(rng);
      editor.insertContent(value);
      if (showVariable) {
        resolverSpansDoTemplate();
      }
      autocompleteApi.hide();
    }
  });
});
