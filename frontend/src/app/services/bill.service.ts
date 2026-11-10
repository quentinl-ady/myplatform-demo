import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Bill, BillPaymentRequest, BillPaymentResult, BillRequest, BillSettings, BillTransferRoutes, PayeeCheck} from '../models';

@Injectable({providedIn: 'root'})
export class BillService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/bills`;
  private readonly http = inject(HttpClient);

  getSettings(userId: string): Observable<BillSettings> {
    return this.http.get<BillSettings>(`${this.baseUrl}/${userId}/settings`);
  }

  /** The latest number first. Also settles the payments in progress that no webhook settled. */
  getBills(userId: string): Observable<Bill[]> {
    return this.http.get<Bill[]>(`${this.baseUrl}/${userId}`);
  }

  getBill(userId: string, billId: number): Observable<Bill> {
    return this.http.get<Bill>(`${this.baseUrl}/${userId}/${billId}`);
  }

  create(userId: string, request: BillRequest): Observable<Bill> {
    return this.http.post<Bill>(`${this.baseUrl}/${userId}`, request);
  }

  /** Only a bill to pay, or whose payment failed, can be edited. */
  update(userId: string, billId: number, request: BillRequest): Observable<Bill> {
    return this.http.put<Bill>(`${this.baseUrl}/${userId}/${billId}`, request);
  }

  delete(userId: string, billId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${userId}/${billId}`);
  }

  /** Verification of Payee of the suppliers of the bills, before they are paid by transfer. */
  checkPayees(userId: string, request: BillPaymentRequest): Observable<PayeeCheck[]> {
    return this.http.post<PayeeCheck[]>(`${this.baseUrl}/${userId}/payee-checks`, request);
  }

  /** The transfer speeds that can pay the bills, from the routes Adyen offers to the bank of each supplier. */
  transferRoutes(userId: string, request: BillPaymentRequest): Observable<BillTransferRoutes[]> {
    return this.http.post<BillTransferRoutes[]>(`${this.baseUrl}/${userId}/transfer-routes`, request);
  }

  /** One transfer per bill. They wait for one approval with SCA on the Batch transfers page. */
  payByTransfer(userId: string, request: BillPaymentRequest): Observable<BillPaymentResult> {
    return this.http.post<BillPaymentResult>(`${this.baseUrl}/${userId}/pay-transfer`, request);
  }

  /** Only while the transfer waits for its approval. */
  cancelTransfer(userId: string, billId: number): Observable<Bill> {
    return this.http.post<Bill>(`${this.baseUrl}/${userId}/${billId}/cancel-transfer`, {});
  }

  /** Issues a virtual card that accepts one payment, up to the total of the bill. */
  payByCard(userId: string, billId: number, brand?: string | null): Observable<Bill> {
    return this.http.post<Bill>(`${this.baseUrl}/${userId}/${billId}/pay-card`, {brand: brand || null});
  }

  /** Only before the supplier charged the card. */
  cancelCard(userId: string, billId: number): Observable<Bill> {
    return this.http.post<Bill>(`${this.baseUrl}/${userId}/${billId}/cancel-card`, {});
  }
}
