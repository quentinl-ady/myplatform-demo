import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {CustomerSubscription, SubscriptionRequest, SubscriptionSettings, SubscriptionTestOutcome} from '../models';

@Injectable({providedIn: 'root'})
export class SubscriptionService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/subscriptions`;
  private readonly http = inject(HttpClient);

  getSettings(userId: string): Observable<SubscriptionSettings> {
    return this.http.get<SubscriptionSettings>(`${this.baseUrl}/${userId}/settings`);
  }

  /** The latest first. Also settles the payments and charges that no webhook settled. */
  getSubscriptions(userId: string): Observable<CustomerSubscription[]> {
    return this.http.get<CustomerSubscription[]>(`${this.baseUrl}/${userId}`);
  }

  getSubscription(userId: string, subscriptionId: number): Observable<CustomerSubscription> {
    return this.http.get<CustomerSubscription>(`${this.baseUrl}/${userId}/${subscriptionId}`);
  }

  /** Creates the subscription and sends its first invoice with a payment link that stores the payment method. */
  create(userId: string, request: SubscriptionRequest): Observable<CustomerSubscription> {
    return this.http.post<CustomerSubscription>(`${this.baseUrl}/${userId}`, request);
  }

  /** Bills the next cycle and charges it, or charges the refused invoice of the last cycle again. */
  runCycle(userId: string, subscriptionId: number, testOutcome?: SubscriptionTestOutcome | null): Observable<CustomerSubscription> {
    return this.http.post<CustomerSubscription>(`${this.baseUrl}/${userId}/${subscriptionId}/run-cycle`,
      {testOutcome: testOutcome ?? null});
  }

  stopRescue(userId: string, subscriptionId: number): Observable<CustomerSubscription> {
    return this.http.post<CustomerSubscription>(`${this.baseUrl}/${userId}/${subscriptionId}/stop-rescue`, {});
  }

  cancel(userId: string, subscriptionId: number): Observable<CustomerSubscription> {
    return this.http.post<CustomerSubscription>(`${this.baseUrl}/${userId}/${subscriptionId}/cancel`, {});
  }
}
