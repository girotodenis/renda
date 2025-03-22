tinymce.PluginManager.add('variaveisMesclagem', function (editor) {

  var showVariable = false; // Valor inicial do botão

  let variables = {'teste.nome': 'teste.nome',
                    'teste.email': 'teste.email'
                  };

  editor.on('loadVariables', function (data) {
      console.warn('editor.loadVariables',data)
      console.warn('editor.loadVariables',data.variablesEvent)
      variables = data.variablesEvent;
      if (showVariable) {
        resolverSpansDoTemplate();
      }
  });

  editor.on('loadContent', function (data) {
      console.warn('editor.loadContent')
      if (showVariable) {
        resolverSpansDoTemplate();
      }
  });

  editor.ui.registry.addButton('showVariable', {
    text: '< - >',
    //text: '<--hide-->',
    //icon: 'eye',
    onAction: function(botao) {
          showVariable = !showVariable; // Alterna o valor do botão

          // botao.setText(showVariable ? '<show>' : '--hide--'); // Alterna o texto do botão
          botao.setText(showVariable ? '<o>' : '< - >'); // Alterna o texto do botão
          // botao.icon(showVariable ? 'eye-slash' : 'eye'); // Alterna o ícone do botão

          resolverSpansDoTemplate();
        }
    });


    let resolverSpansDoTemplate = () => {
      // Pega todos os elementos com a classe 'variaveisMesclagem'
      let elements = editor.dom.select('.variaveisMesclagem');
      elements.forEach(function(element) {
        // Pega o id do variável (que é o atributo data-var do elemento)
          var spanVar = Array.from(element.attributes).find(function(elemento) {
            return elemento.name == 'data-var';
          });
          if(spanVar){
            let variableName = spanVar.nodeValue;
            // Se o botão estiver em 'show', mostrar o valor da variável
            if (showVariable) {

                element.innerHTML = '';
                element.innerText = '';
                var meuSpan = editor.dom.create('span');
                meuSpan.textContent = variables[variableName];
                element.appendChild(meuSpan);

                editor.dom.addClass(element, 'valorMesclado');
              }
            // Se o botão estiver em 'hide', mostrar o nome da variável
            else {
              element.innerHTML = '';
              element.innerText = '';
              var meuSpan = editor.dom.create('span');
              meuSpan.textContent = '@'+variableName;
              meuSpan.style.color = 'navy';
              meuSpan.style.fontStyle = 'italic';
              element.appendChild(meuSpan);
              editor.dom.removeClass(element, 'valorMesclado')
            }
          }
      });
    }

    editor.ui.registry.addAutocompleter('variables', {
    ch: '@',
    minChars: 0,
    columns: 1,
    fetch: function (pattern) {

      let matchedVariables = Object.keys(variables).filter(item => item.includes(pattern));
      return new Promise(function (resolve) {
        resolve(matchedVariables.map(function (item) {
          return {
            value: `<span data-var="${item}" class="variaveisMesclagem"><span style="color: navy; font-style: italic;">@${item}</span></span> `,
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
