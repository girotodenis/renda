import { Component, OnInit } from '@angular/core';
import {Router} from '@angular/router'


import { SocialAuthService, GoogleLoginProvider, SocialUser } from 'angularx-social-login';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {


  socialUser: SocialUser;
  isLoggedin: boolean;  
  
  constructor(
    private socialAuthService: SocialAuthService,
    private router: Router
  ) { 

    if(localStorage['userLogin']){
      let user:SocialUser = JSON.parse(localStorage['userLogin']) as SocialUser;
      if(user){
        this.socialUser = user;
        this.isLoggedin = (user != null);
      }
      console.log('user',user)
    }
  }

  ngOnInit() {
    this.socialAuthService.authState.subscribe((user) => {
      this.socialUser = user;
      this.isLoggedin = (user != null);
      if(this.isLoggedin){
        console.log('login',this.socialUser)
        localStorage['userLogin'] = JSON.stringify(this.socialUser) ;
        //this.router.navigate(['/home']);
      }else{
        // let user:SocialUser = JSON.parse(localStorage['userLogin']) as SocialUser;
        console.log('logout')
        localStorage['userLogin'] = null;
        //this.router.navigate(['/login']);
      }
    });
  }

  loginWithGoogle(): void {
    this.socialAuthService.signIn(GoogleLoginProvider.PROVIDER_ID);
  }

  logOut(): void {
    if(this.isLoggedin){
      localStorage['userLogin'] = null;
      this.socialUser = null;
      this.isLoggedin = false;
      this.socialAuthService.signOut();
    }
  }

}
