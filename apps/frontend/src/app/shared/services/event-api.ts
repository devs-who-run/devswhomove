import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Event } from '../types';

@Injectable({
  providedIn: 'root',
})
export class EventApiService {
  private http = inject(HttpClient);

  private readonly apiUrl = 'http://localhost:3001/events';

  getEvents(): Observable<Event[]> {
    return this.http.get<Event[]>(`${this.apiUrl}/all`);
  }
}
