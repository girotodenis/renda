import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent implements OnInit {

  nome: String;
  urlFoto: String;
  

  constructor() { 
    if(localStorage['userLogin']){
      let user = JSON.parse(localStorage['userLogin']);
      if(user){
        this.nome = user.name;
        this.urlFoto = user.photoUrl;
      }
      console.log('user',user)
    }
  }

  ngOnInit(): void {
  }

}
