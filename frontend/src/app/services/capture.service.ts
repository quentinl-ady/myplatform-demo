import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {CapturePayload, CheckoutPayment} from '../models';

@Injectable({providedIn: 'root'})
export class CaptureService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/captures`;
  private readonly http = inject(HttpClient);

  getPayments(userId: string): Observable<CheckoutPayment[]> {
    return this.http.get<CheckoutPayment[]>(this.baseUrl, {params: {userId}});
  }

  /** Sends the Drop-in sessionResult so the payment gets its PSP reference without waiting for the webhook. */
  syncSessionResult(paymentId: string, userId: string, sessionResult: string): Observable<CheckoutPayment> {
    return this.http.post<CheckoutPayment>(`${this.baseUrl}/${encodeURIComponent(paymentId)}/session-result`, {userId, sessionResult});
  }

  capture(paymentId: string, payload: CapturePayload): Observable<CheckoutPayment> {
    return this.http.post<CheckoutPayment>(`${this.baseUrl}/${encodeURIComponent(paymentId)}/capture`, payload);
  }

  cancel(paymentId: string, userId: string): Observable<CheckoutPayment> {
    return this.http.post<CheckoutPayment>(`${this.baseUrl}/${encodeURIComponent(paymentId)}/cancel`, {userId});
  }
}
