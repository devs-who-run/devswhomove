import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Event } from '../types';
import { BASE_API_URL } from '../context/base-api-url';

@Injectable({
  providedIn: 'root',
})
export class EventApiService {
  private http = inject(HttpClient);
  private baseUrl = inject(BASE_API_URL);

  private readonly apiUrl = `${this.baseUrl}/events`;

  getEvents(): Observable<Event[]> {
    return this.http.get<Event[]>(`${this.apiUrl}/all`);
  }
}
