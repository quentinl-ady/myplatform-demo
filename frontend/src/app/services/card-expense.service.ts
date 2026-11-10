import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {CardExpense, CardExpenseRequest, CardExpenseSettings, ReceiptUpload} from '../models';

/** How the card payments are booked: their expense category, tax, note and receipt. */
@Injectable({providedIn: 'root'})
export class CardExpenseService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/card-expenses`;
  private readonly http = inject(HttpClient);

  getSettings(userId: string): Observable<CardExpenseSettings> {
    return this.http.get<CardExpenseSettings>(`${this.baseUrl}/${userId}/settings`);
  }

  /** The payments the user classified, the latest first. */
  getExpenses(userId: string): Observable<CardExpense[]> {
    return this.http.get<CardExpense[]>(`${this.baseUrl}/${userId}`);
  }

  /** Classifies a payment, or changes how it's classified. */
  save(userId: string, transferId: string, request: CardExpenseRequest): Observable<CardExpense> {
    return this.http.put<CardExpense>(`${this.baseUrl}/${userId}/${encodeURIComponent(transferId)}`, request);
  }

  /** Forgets how the payment is classified, and its receipt: the journal books it to Suspense again. */
  delete(userId: string, transferId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${userId}/${encodeURIComponent(transferId)}`);
  }

  /** Adds the receipt of a payment, or replaces it. A payment not classified yet gets its suggested category. */
  uploadReceipt(userId: string, transferId: string, upload: ReceiptUpload): Observable<CardExpense> {
    return this.http.put<CardExpense>(`${this.baseUrl}/${userId}/${encodeURIComponent(transferId)}/receipt`, upload);
  }

  downloadReceipt(userId: string, transferId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${userId}/${encodeURIComponent(transferId)}/receipt`, {responseType: 'blob'});
  }

  deleteReceipt(userId: string, transferId: string): Observable<CardExpense> {
    return this.http.delete<CardExpense>(`${this.baseUrl}/${userId}/${encodeURIComponent(transferId)}/receipt`);
  }
}
