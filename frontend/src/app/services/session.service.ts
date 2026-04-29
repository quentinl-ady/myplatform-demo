import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {SessionToken} from '../models';

@Injectable({providedIn: 'root'})
export class SessionService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getPaymentInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/payments`);
  }

  getReportInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/reports`);
  }

  getPayByLinkInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/pay-by-link`);
  }

  getPayoutInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/payouts`);
  }

  getDisputeInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/disputes`);
  }

  getBusinessLoans(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/business-loans`);
  }

  getExternalBankAccountSession(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/api/sessions/${userId}/external-bank-account`);
  }
}
