import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {BalanceAccount, InternalTransferRequest, CashoutRequest} from '../models';

@Injectable({providedIn: 'root'})
export class CashManagementService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  createBalanceAccount(userId: string, description: string): Observable<BalanceAccount> {
    return this.http.post<BalanceAccount>(`${this.baseUrl}/api/cash-management/${userId}/balance-accounts`, {description});
  }

  internalTransfer(request: InternalTransferRequest): Observable<any> {
    return this.http.post(`${this.baseUrl}/api/cash-management/internal-transfer`, request);
  }

  cashout(request: CashoutRequest): Observable<any> {
    return this.http.post(`${this.baseUrl}/api/cash-management/cashout`, request);
  }

  updateSweepStatus(userId: string, balanceAccountId: string, sweepId: string, active: boolean): Observable<any> {
    return this.http.patch(`${this.baseUrl}/api/cash-management/${userId}/balance-accounts/${balanceAccountId}/sweeps/${sweepId}`, {active});
  }
}
