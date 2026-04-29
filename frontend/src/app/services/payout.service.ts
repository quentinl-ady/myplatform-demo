import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {PayoutAccount, PayoutConfiguration, PayoutConfigurationPayload} from '../models';

@Injectable({providedIn: 'root'})
export class PayoutService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getPayoutAccounts(userId: number): Observable<PayoutAccount[]> {
    return this.http.get<PayoutAccount[]>(`${this.baseUrl}/api/payouts/${userId}/accounts`);
  }

  createPayoutConfiguration(payload: PayoutConfigurationPayload): Observable<PayoutConfiguration> {
    return this.http.post<PayoutConfiguration>(`${this.baseUrl}/api/payouts/configurations`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  getPayoutConfigurations(userId: number, balanceAccountId: string): Observable<PayoutConfiguration[]> {
    return this.http.get<PayoutConfiguration[]>(`${this.baseUrl}/api/payouts/${userId}/configurations/${balanceAccountId}`);
  }
}
