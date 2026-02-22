import { inject, Injectable } from '@angular/core';
import { AuthApiService } from './auth-api';

@Injectable({
  providedIn: 'root',
})
export class UserState {
  public authApi = inject(AuthApiService);

  public currentUserName = this.authApi.currentUser()?.name;
}
