import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EditorService {

  private editorInstance: any; // Referência ao editor TinyMCE

  // Método para inicializar o editor (chamado no setup do TinyMCE)
  setEditorInstance(editor: any) {
    this.editorInstance = editor;
  }

  // Método para disparar eventos no editor
  fireEvent(eventName: string, data: any) {
    if (this.editorInstance) {
      console.info('fireEvent: ', eventName);
      this.editorInstance.fire(eventName, {data: data} );
    } else {
      console.error('Editor instance is not initialized yet.');
    }
  }

  // Método para verificar se o editor está inicializado
  private waitForEditorInstance(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.editorInstance) {
          clearInterval(checkInterval); // Para o intervalo
          resolve(); // Resolve a Promise
        }
      }, 100); // Verifica a cada 100ms
    });
  }

  // Método para a escutar eventos
  onEditorEvent(eventName: string, callback: (eventData: any, editor: any) => void ): void {
    this.editorInstance.on(eventName, (event: any) => {
      console.log('listerne :', eventName);
      callback(event.data, this.editorInstance);
    });
  }

  // Método para escutar eventos de forma assíncrona
  async onEditorEventAssinc(
    eventName: string,
    callback: (eventData: any, editor: any) => void
  ): Promise<void> {
    // Aguarda até que o editor tenha sido inicializado
    await this.waitForEditorInstance();

    // Registra o evento no editor
    this.editorInstance.on(eventName, (event: any) => {
      callback(event.data, this.editorInstance);
    });
  }

}
