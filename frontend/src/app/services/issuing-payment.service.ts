import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {SendPaymentPayload, SendPaymentResponse, Store, StoredPaymentMethod, TokenPaymentPayload, TokenPaymentResponse} from '../models';

export interface IssuingUserInfo {
  userId: string;
  activityReason: string;
  countryCode: string;
}

@Injectable({providedIn: 'root'})
export class IssuingPaymentService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getClientKey(): Observable<{ key: string }> {
    return this.http.get<{ key: string }>(`${this.baseUrl}/api/issuing-payments/client-key`);
  }

  getUserInfo(): Observable<IssuingUserInfo> {
    return this.http.get<IssuingUserInfo>(`${this.baseUrl}/api/issuing-payments/user-info`);
  }

  getStores(userId: string): Observable<Store[]> {
    return this.http.get<Store[]>(`${this.baseUrl}/api/stores/${userId}`);
  }

  sendPayment(payload: SendPaymentPayload): Observable<SendPaymentResponse> {
    return this.http.post<SendPaymentResponse>(`${this.baseUrl}/api/issuing-payments/session`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  createTokenizationSession(payload: SendPaymentPayload): Observable<SendPaymentResponse> {
    return this.http.post<SendPaymentResponse>(`${this.baseUrl}/api/issuing-payments/tokenize-session`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  getStoredPaymentMethods(storeReference: string): Observable<StoredPaymentMethod[]> {
    return this.http.get<StoredPaymentMethod[]>(`${this.baseUrl}/api/issuing-payments/stored-payment-methods`, {
      params: { storeReference }
    });
  }

  deleteStoredPaymentMethod(storeReference: string, recurringDetailReference: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.baseUrl}/api/issuing-payments/stored-payment-methods`, {
      params: { storeReference, recurringDetailReference }
    });
  }

  makeTokenPayment(payload: TokenPaymentPayload): Observable<TokenPaymentResponse> {
    return this.http.post<TokenPaymentResponse>(`${this.baseUrl}/api/issuing-payments/token-payment`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }
}
