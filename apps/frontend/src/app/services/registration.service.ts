import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_API_URL } from '../shared/context/base-api-url';

export enum RegistrationStatus {
  CONFIRMED = 'confirmed',
  WAITLIST = 'waitlist',
}

export interface Registration {
  id: string;
  eventId: string;
  userId: string;
  userName: string;
  status: RegistrationStatus;
  waitlistPosition?: number;
  registeredAt: Date;
}

export interface CreateRegistration {
  eventId: string;
  userId: string;
  userName: string;
}

export interface RegistrationCounts {
  confirmedCount: number;
  waitlistCount: number;
  availableSpots: number;
}

@Injectable({
  providedIn: 'root',
})
export class RegistrationService {
  private readonly http = inject(HttpClient);
  private readonly baseApiUrl = inject(BASE_API_URL);
  private readonly apiUrl = `${this.baseApiUrl}/registrations`;

  registerForEvent(registration: CreateRegistration): Observable<Registration> {
    return this.http.post<Registration>(
      `${this.apiUrl}/register`,
      registration
    );
  }

  unregisterFromEvent(
    eventId: string,
    userId: string
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/${eventId}/user/${userId}`
    );
  }

  getEventRegistrations(eventId: string): Observable<Registration[]> {
    return this.http.get<Registration[]>(`${this.apiUrl}/event/${eventId}`);
  }

  getConfirmedRegistrations(eventId: string): Observable<Registration[]> {
    return this.http.get<Registration[]>(
      `${this.apiUrl}/event/${eventId}/confirmed`
    );
  }

  getWaitlistRegistrations(eventId: string): Observable<Registration[]> {
    return this.http.get<Registration[]>(
      `${this.apiUrl}/event/${eventId}/waitlist`
    );
  }

  getUserRegistrations(userId: string): Observable<Registration[]> {
    return this.http.get<Registration[]>(`${this.apiUrl}/user/${userId}`);
  }

  getUserRegistrationStatus(
    eventId: string,
    userId: string
  ): Observable<Registration | null> {
    return this.http.get<Registration | null>(
      `${this.apiUrl}/status/${eventId}/user/${userId}`
    );
  }

  getRegistrationCounts(eventId: string): Observable<RegistrationCounts> {
    return this.http.get<RegistrationCounts>(
      `${this.apiUrl}/counts/${eventId}`
    );
  }
}
