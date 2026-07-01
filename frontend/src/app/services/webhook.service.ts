import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { WebhookEvent, WebhookUnreadCount, WebhookNotificationSummary } from '../models';

@Injectable({ providedIn: 'root' })
export class WebhookService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  private readonly webhookReceived$ = new Subject<void>();
  readonly onWebhookReceived$ = this.webhookReceived$.asObservable();

  pushWebhook(rawJson: string): Observable<WebhookEvent> {
    return this.http.post<WebhookEvent>(`${this.baseUrl}/api/webhooks/push`, rawJson, {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  getEvents(userId: string): Observable<WebhookEvent[]> {
    return this.http.get<WebhookEvent[]>(`${this.baseUrl}/api/webhooks/events/${userId}`);
  }

  getUnreadEvents(userId: string): Observable<WebhookEvent[]> {
    return this.http.get<WebhookEvent[]>(`${this.baseUrl}/api/webhooks/events/${userId}/unread`);
  }

  getUnreadCount(userId: string): Observable<WebhookUnreadCount> {
    return this.http.get<WebhookUnreadCount>(`${this.baseUrl}/api/webhooks/events/${userId}/count`);
  }

  getNotificationSummary(userId: string): Observable<WebhookNotificationSummary> {
    return this.http.get<WebhookNotificationSummary>(`${this.baseUrl}/api/webhooks/events/${userId}/summary`);
  }

  acknowledgeEvent(eventId: number): Observable<WebhookEvent> {
    return this.http.patch<WebhookEvent>(`${this.baseUrl}/api/webhooks/events/${eventId}/acknowledge`, {});
  }

  acknowledgeAll(userId: string): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/api/webhooks/events/${userId}/acknowledge-all`, {});
  }

  notifyWebhookReceived(): void {
    this.webhookReceived$.next();
  }
}
