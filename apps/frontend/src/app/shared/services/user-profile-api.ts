import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_API_URL } from '../context/base-api-url';

export interface UserProfileResponse {
  id: string;
  authUserId: string;
  name: string;
  email: string;
  country: string;
  city: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateUserProfileRequest {
  name?: string;
  country?: string;
  city?: string;
}

@Injectable({
  providedIn: 'root',
})
export class UserProfileApiService {
  private http = inject(HttpClient);
  private baseUrl = inject(BASE_API_URL);

  private readonly apiUrl = `${this.baseUrl}/user-profile`;

  getProfile(authUserId: string): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(`${this.apiUrl}/${authUserId}`);
  }

  updateProfile(
    authUserId: string,
    data: UpdateUserProfileRequest
  ): Observable<UserProfileResponse> {
    return this.http.put<UserProfileResponse>(
      `${this.apiUrl}/${authUserId}`,
      data
    );
  }
}
