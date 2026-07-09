import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {PosPaymentRequest, PosPaymentResponse, SendPaymentPayload, SendPaymentResponse, StoredPaymentMethod, TokenPaymentPayload, TokenPaymentResponse} from '../models';

@Injectable({providedIn: 'root'})
export class PaymentService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  sendPayment(payload: SendPaymentPayload): Observable<SendPaymentResponse> {
    return this.http.post<SendPaymentResponse>(`${this.baseUrl}/api/payments/session`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  getClientKey(): Observable<{ key: string }> {
    return this.http.get<{ key: string }>(`${this.baseUrl}/api/payments/client-key`);
  }

  handleShopperRedirect(data: any): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/payments/redirect`, data);
  }

  getGooglePayJwt(hostname: string): Observable<{ googlePayJwtToken: string }> {
    return this.http.get<{ googlePayJwtToken: string }>(`${this.baseUrl}/api/payments/gpay-jwt`, {
      params: {hostname}
    });
  }

  makePosPayment(payload: PosPaymentRequest): Observable<PosPaymentResponse> {
    return this.http.post<PosPaymentResponse>(`${this.baseUrl}/api/pos/pay`, payload, {
      responseType: 'json'
    });
  }

  createTokenizationSession(payload: SendPaymentPayload): Observable<SendPaymentResponse> {
    return this.http.post<SendPaymentResponse>(`${this.baseUrl}/api/payments/tokenize-session`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  getStoredPaymentMethods(userId: string, storeReference: string): Observable<StoredPaymentMethod[]> {
    return this.http.get<StoredPaymentMethod[]>(`${this.baseUrl}/api/payments/stored-payment-methods`, {
      params: { userId, storeReference }
    });
  }

  deleteStoredPaymentMethod(userId: string, storeReference: string, recurringDetailReference: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.baseUrl}/api/payments/stored-payment-methods`, {
      params: { userId, storeReference, recurringDetailReference }
    });
  }

  makeTokenPayment(payload: TokenPaymentPayload): Observable<TokenPaymentResponse> {
    return this.http.post<TokenPaymentResponse>(`${this.baseUrl}/api/payments/token-payment`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }
}
