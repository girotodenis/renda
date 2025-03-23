import { Component, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorService } from '../../utils/tinymce/editor.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-modal-modelos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-modelos.component.html',
  styleUrls: ['./modal-modelos.component.css'],
})
export class ModalModelosComponent implements OnInit {
  isModalOpen = false; // Controla se a modal está aberta ou não
  filtro: string = ''; // Texto do filtro
  lista: Array<any> = []; // Lista original
  arvoreFiltrada: Array<any> = []; // Lista filtrada (agrupada por tipo)
  itemSelecionado: any = null; // Item atualmente selecionado

  constructor(private editorService: EditorService, private ngZone: NgZone) {}

  ngOnInit() {
    console.log('ModalModelosComponent initialized');
    this.lista = [
      { id: 1, nome: 'Certidão de Casamento', tipo: 'Certidão', html: '<p>Certidão de Casamento</p><p>Nome: <span class="variaveisMesclagem" data-var="a.nome"><span style="color: navy; font-style: italic;">@a.nome</span></span></p>', variaveis : {'a.nome': 'aaaTeste nome', 'b.email': 'bbbsdkfi@gmail.com' } },
      { id: 2, nome: 'Certidão de Nascimento', tipo: 'Certidão', html: '<p>Certidão de Nascimento</p><p>Nome: <span class="variaveisMesclagem" data-var="b.nome"><span style="color: navy; font-style: italic;">@b.nome</span></span></p>',variaveis : {'b.nome': 'bbbTeste nome', 'c.email': 'ccccsdkfi@gmail.com' } },
      { id: 3, nome: 'Contrato de Aluguel', tipo: 'Contrato', html:'<p>Contrato de Aluguel</p><p>Nome: <span class="variaveisMesclagem" data-var="c.nome"><span style="color: navy; font-style: italic;">@c.nome</span></span></p> ',variaveis : {'c.nome': 'cccTeste nome', 'd.email': 'dddsdkfi@gmail.com' } },
      { id: 4, nome: 'Contrato de Venda', tipo: 'Contrato', html: '<p>Contrato de Venda</p><p>Nome: <span class="variaveisMesclagem" data-var="d.nome"><span style="color: navy; font-style: italic;">@d.nome</span></span></p>',variaveis : {'d.nome': 'dddTeste nome', 'e.email': 'eeesdkfi@gmail.com' } },
    ];

    // Gerar a árvore inicial
    this.gerarArvore();

    // Registra o listener para o evento do TinyMCE
    this.editorService.onEditorEventAssinc('evento_abrir_modelos', () => {
      this.abrirModal(); // Abre a modal quando o evento for disparado
      console.log('evento_abrir_modelos disparado' , this.isModalOpen);
    });
  }

  abrirModal() {
    // Executar dentro da zona do Angular
    this.ngZone.run(() => {
      console.log('Abrindo modal');
      this.isModalOpen = true;
    });
  }

  fecharModal() {
    // Executar dentro da zona do Angular
    this.ngZone.run(() => {
      console.log('Fechando modal');
      this.isModalOpen = false;
    });

  }
  // Agrupar itens por tipo
  gerarArvore() {
    const grupos: { [key: string]: any[] } = {};
    for (const item of this.lista) {
      if (!grupos[item.tipo]) {
        grupos[item.tipo] = [];
      }
      grupos[item.tipo].push(item);
    }

    // Converter objeto em array para exibição
    this.arvoreFiltrada = Object.keys(grupos).map((tipo) => ({
      tipo,
      itens: grupos[tipo],
    }));
  }

  // Filtrar a árvore com base no texto do filtro
  filtrarArvore() {
    const filtroLower = this.filtro.toLowerCase();

    // Filtrar itens por nome
    const grupos: { [key: string]: any[] } = {};
    for (const item of this.lista) {
      if (item.nome.toLowerCase().includes(filtroLower)) {
        if (!grupos[item.tipo]) {
          grupos[item.tipo] = [];
        }
        grupos[item.tipo].push(item);
      }
    }

    // Converter objeto em array para exibição
    this.arvoreFiltrada = Object.keys(grupos).map((tipo) => ({
      tipo,
      itens: grupos[tipo],
    }));
  }

  // Selecionar um item da árvore
  selecionarItem(item: any) {
    this.itemSelecionado = item;
  }

  // Confirmar seleção
  confirmarSelecao() {
    console.log('Item selecionado:', this.itemSelecionado);
    this.editorService.fireEvent('nome_arquivo', this.itemSelecionado.nome);

    if(this.itemSelecionado.variaveis){
      this.editorService.fireEvent('loadVariables',this.itemSelecionado.variaveis);
    }

    this.editorService.fireEvent('atualizar_content', this.itemSelecionado.html);
    this.editorService.fireEvent('loadContent', null);
    this.fecharModal();
  }

  // Cancelar seleção
  cancelarSelecao() {
    this.itemSelecionado = null; // Limpar seleção
    this.filtro = ''; // Resetar filtro
    this.gerarArvore(); // Resetar árvore
    this.fecharModal();
  }

}
