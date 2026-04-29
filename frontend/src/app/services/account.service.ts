import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {shareReplay} from 'rxjs/operators';
import {environment} from '../../environments/environment';
import {BalanceAccount, BankAccountInformationResponse, BankAccountStatus, User} from '../models';

@Injectable({providedIn: 'root'})
export class AccountService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  private cachedUserId: number | null = null;
  private cachedUser$: Observable<User> | null = null;

  getUserById(userId: number): Observable<User> {
    if (this.cachedUserId !== userId || !this.cachedUser$) {
      this.cachedUserId = userId;
      this.cachedUser$ = this.http.get<User>(`${this.baseUrl}/api/users/${userId}`).pipe(
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.cachedUser$;
  }

  invalidateUserCache(): void {
    this.cachedUserId = null;
    this.cachedUser$ = null;
  }

  getBalanceAccounts(userId: number): Observable<BalanceAccount[]> {
    return this.http.get<BalanceAccount[]>(`${this.baseUrl}/api/accounts/${userId}/balance`);
  }

  createBankAccount(userId: number): Observable<{ bankAccountId: string; bankAccountNumber: string }> {
    return this.http.post<{ bankAccountId: string; bankAccountNumber: string }>(`${this.baseUrl}/api/accounts/${userId}/bank`, {});
  }

  getBankAccountStatus(userId: number): Observable<BankAccountStatus> {
    return this.http.get<BankAccountStatus>(`${this.baseUrl}/api/accounts/${userId}/bank/status`);
  }

  getBankAccountInformation(userId: number): Observable<BankAccountInformationResponse> {
    return this.http.get<BankAccountInformationResponse>(`${this.baseUrl}/api/accounts/${userId}/bank`);
  }

  getRibPdf(userId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/api/bank-statement/rib/pdf`, {
      params: {userId},
      responseType: 'blob'
    });
  }
}
