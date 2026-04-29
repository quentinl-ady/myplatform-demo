import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {
  AddTransactionRuleRequest,
  CardResponse,
  CardTransfer,
  CreateCardRequest,
  PhonePrefix,
  TransactionRuleResponse
} from '../models';

@Injectable({providedIn: 'root'})
export class IssuingService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  createCard(request: CreateCardRequest): Observable<CardResponse> {
    return this.http.post<CardResponse>(`${this.baseUrl}/api/issuing/cards`, request);
  }

  getPhonePrefixes(): Observable<PhonePrefix[]> {
    return this.http.get<PhonePrefix[]>(`${this.baseUrl}/api/issuing/phone-prefixes`);
  }

  getCards(userId: number, status?: string): Observable<CardResponse[]> {
    const params = status ? `?status=${status}` : '';
    return this.http.get<CardResponse[]>(`${this.baseUrl}/api/issuing/cards/${userId}${params}`);
  }

  getCardDetails(paymentInstrumentId: string): Observable<CardResponse> {
    return this.http.get<CardResponse>(`${this.baseUrl}/api/issuing/card/${paymentInstrumentId}`);
  }

  updateCardStatus(paymentInstrumentId: string, status: string): Observable<{ status: string; newStatus: string }> {
    return this.http.put<{ status: string; newStatus: string }>(`${this.baseUrl}/api/issuing/cards/status`, {
      paymentInstrumentId,
      status
    });
  }

  addTransactionRule(request: AddTransactionRuleRequest): Observable<{ ruleId: string; status: string }> {
    return this.http.post<{ ruleId: string; status: string }>(`${this.baseUrl}/api/issuing/rules`, request);
  }

  getTransactionRules(paymentInstrumentId: string): Observable<TransactionRuleResponse[]> {
    return this.http.get<TransactionRuleResponse[]>(`${this.baseUrl}/api/issuing/rules/${paymentInstrumentId}`);
  }

  updateTransactionRule(ruleId: string, status: string): Observable<{ status: string }> {
    return this.http.put<{ status: string }>(`${this.baseUrl}/api/issuing/rules/${ruleId}`, {status});
  }

  deleteTransactionRule(ruleId: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.baseUrl}/api/issuing/rules/${ruleId}`);
  }

  revealCardData(paymentInstrumentId: string): Observable<{ cardData: string }> {
    return this.http.post<{ cardData: string }>(`${this.baseUrl}/api/issuing/reveal`, {paymentInstrumentId});
  }

  getCardTransfers(userId: number, paymentInstrumentId?: string): Observable<CardTransfer[]> {
    let params = `?userId=${userId}`;
    if (paymentInstrumentId) {
      params += `&paymentInstrumentId=${paymentInstrumentId}`;
    }
    return this.http.get<CardTransfer[]>(`${this.baseUrl}/api/issuing/transfers${params}`);
  }
}
