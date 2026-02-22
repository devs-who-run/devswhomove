import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_API_URL } from '../shared/context/base-api-url';

export interface Event {
  id?: string;
  conference: string;
  eventType: string;
  date: string;
  location: string;
  name: string;
  sport: string;
  description: string;
  time: string;
  capacity: number;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable({
  providedIn: 'root',
})
export class EventService {
  private readonly http = inject(HttpClient);
  private readonly baseApiUrl = inject(BASE_API_URL);
  private readonly apiUrl = `${this.baseApiUrl}/events`;

  getAllEvents(): Observable<Event[]> {
    return this.http.get<Event[]>(`${this.apiUrl}/all`);
  }

  getEventById(id: string): Observable<Event> {
    return this.http.get<Event>(`${this.apiUrl}/${id}`);
  }

  createEvent(
    event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>
  ): Observable<Event> {
    return this.http.post<Event>(`${this.apiUrl}/add`, event);
  }

  getEventsByConference(conference: string): Observable<Event[]> {
    return this.http.get<Event[]>(`${this.apiUrl}/conference/${conference}`);
  }

  getEventsByType(eventType: string): Observable<Event[]> {
    return this.http.get<Event[]>(`${this.apiUrl}/type/${eventType}`);
  }
}
