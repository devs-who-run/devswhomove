import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Event } from '../types';

@Injectable({
  providedIn: 'root',
})
export class EventApiService {
  private readonly apiUrl = 'http://localhost:3001/events';

  constructor(private http: HttpClient) {}

  getEvents(): Observable<Event[]> {
    return this.http.get<Event[]>(`${this.apiUrl}/all`);
  }
}
