import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { UserProfile, AuthResponse } from '../types';
import { BASE_API_URL } from '../context/base-api-url';

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private http = inject(HttpClient);
  private baseUrl = inject(BASE_API_URL);

  private readonly apiUrl = `${this.baseUrl}/auth`;

  public currentUser = signal<UserProfile | null>(null);

  constructor() {
    this.loadStoredSession();
  }

  initiateGitHubLogin(): Observable<AuthResponse> {
    const successUrl = `${window.location.origin}/auth/success`;
    const failureUrl = `${window.location.origin}/auth/error`;

    return this.http
      .post<AuthResponse>(`${this.apiUrl}/github/login`, {
        successUrl,
        failureUrl,
      })
      .pipe(
        tap((response) => {
          if (response.success && response.data?.oauthUrl) {
            window.location.href = response.data.oauthUrl;
          }
        }),
        catchError((error) => {
          console.error('GitHub login initiation failed:', error);
          throw error;
        })
      );
  }

  exchangeSecretForSession(
    secret: string,
    userId: string
  ): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/exchange-secret`, {
        secret,
        userId,
      })
      .pipe(
        tap((response: AuthResponse) => {
          if (
            response.success &&
            response.data?.user &&
            response.data?.secretToken
          ) {
            localStorage.setItem(
              'devswhorun_secretToken',
              response.data.secretToken
            );
            localStorage.setItem(
              'devswhorun_user',
              JSON.stringify(response.data.user)
            );
            this.currentUser.set(response.data.user);
          }
        }),
        catchError((error) => {
          console.error('Failed to exchange secret for session:', error);
          throw error;
        })
      );
  }

  getUserProfile(secretToken: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/profile`, { secretToken })
      .pipe(
        tap((response: AuthResponse) => {
          if (response.success && response.data?.user) {
            localStorage.setItem('devswhorun_secretToken', secretToken);
            localStorage.setItem(
              'devswhorun_user',
              JSON.stringify(response.data.user)
            );
            this.currentUser.set(response.data.user);
          }
        }),
        catchError((error) => {
          console.error('Failed to get user profile:', error);
          throw error;
        })
      );
  }

  verifySession(secretToken: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/verify`, {
        secretToken,
      })
      .pipe(
        tap(({ success, data }) => {
          if (success) {
            const { id, name, email, avatar, provider } = data as UserProfile;
            const userProfile: UserProfile = {
              id,
              name,
              email,
              avatar,
              provider,
            };
            this.currentUser.set(userProfile);
          } else {
            this.clearSession();
          }
        })
      );
  }

  logout(): Observable<AuthResponse> {
    const secretToken = localStorage.getItem('devswhorun_secretToken');
    if (!secretToken) {
      this.clearSession();
      return new Observable((observer) => {
        observer.next({ success: true, message: 'Already logged out' });
        observer.complete();
      });
    }

    return this.http
      .post<AuthResponse>(`${this.apiUrl}/logout`, {
        secretToken,
      })
      .pipe(
        tap(() => {
          this.clearSession();
        })
      );
  }

  private loadStoredSession(): void {
    const secretToken = localStorage.getItem('devswhorun_secretToken');
    const storedUser = localStorage.getItem('devswhorun_user');

    if (secretToken && storedUser) {
      try {
        const user = JSON.parse(storedUser);
        this.currentUser.set(user);
        this.verifySession(secretToken).subscribe({
          error: () => {
            this.clearSession();
          },
        });
      } catch (error) {
        console.error('Failed to parse stored user data:', error);
        this.clearSession();
      }
    }
  }

  private clearSession(): void {
    localStorage.removeItem('devswhorun_secretToken');
    localStorage.removeItem('devswhorun_user');
    this.currentUser.set(null);
  }

  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  getCurrentUser(): UserProfile | null {
    return this.currentUser();
  }
}
