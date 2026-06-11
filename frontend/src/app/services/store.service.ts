import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Store, StorePayload, TerminalResponse} from '../models';

@Injectable({providedIn: 'root'})
export class StoreService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  createStore(userId: string, payload: StorePayload): Observable<Store> {
    return this.http.post<Store>(`${this.baseUrl}/api/stores/${userId}`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  getStores(userId: string): Observable<Store[]> {
    return this.http.get<Store[]>(`${this.baseUrl}/api/stores/${userId}`);
  }

  addPaymentMethods(userId: string, storeId: string, paymentMethods: string[]): Observable<{ type: string; verificationStatus: string; paymentMethodId: string; enabled: boolean }[]> {
    return this.http.post<{ type: string; verificationStatus: string; paymentMethodId: string; enabled: boolean }[]>(
      `${this.baseUrl}/api/stores/${userId}/${storeId}/paymentMethods`, paymentMethods,
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  togglePaymentMethod(paymentMethodId: string, enabled: boolean): Observable<{ type: string; verificationStatus: string; paymentMethodId: string; enabled: boolean }> {
    return this.http.patch<{ type: string; verificationStatus: string; paymentMethodId: string; enabled: boolean }>(
      `${this.baseUrl}/api/stores/paymentMethods/${paymentMethodId}`, { enabled }
    );
  }

  listTerminals(storeId: string): Observable<TerminalResponse[]> {
    return this.http.get<TerminalResponse[]>(`${this.baseUrl}/api/stores/${storeId}/terminals`);
  }
}
