import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Invoice, InvoiceRequest, InvoiceSettings, InvoiceTerminal, TerminalResult} from '../models';

@Injectable({providedIn: 'root'})
export class InvoiceService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/invoices`;
  private readonly http = inject(HttpClient);

  getSettings(userId: string): Observable<InvoiceSettings> {
    return this.http.get<InvoiceSettings>(`${this.baseUrl}/${userId}/settings`);
  }

  /** The latest number first. Also settles the open payment links that no webhook settled. */
  getInvoices(userId: string): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(`${this.baseUrl}/${userId}`);
  }

  getInvoice(userId: string, invoiceId: number): Observable<Invoice> {
    return this.http.get<Invoice>(`${this.baseUrl}/${userId}/${invoiceId}`);
  }

  create(userId: string, request: InvoiceRequest): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.baseUrl}/${userId}`, request);
  }

  update(userId: string, invoiceId: number, request: InvoiceRequest): Observable<Invoice> {
    return this.http.put<Invoice>(`${this.baseUrl}/${userId}/${invoiceId}`, request);
  }

  /** Issues the invoice with a payment link, or replaces the link that expired. */
  send(userId: string, invoiceId: number): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.baseUrl}/${userId}/${invoiceId}/send`, {});
  }

  voidInvoice(userId: string, invoiceId: number): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.baseUrl}/${userId}/${invoiceId}/void`, {});
  }

  /** The terminals boarded in the stores of the account. */
  getTerminals(userId: string): Observable<InvoiceTerminal[]> {
    return this.http.get<InvoiceTerminal[]>(`${this.baseUrl}/${userId}/terminals`);
  }

  /** Collects the payment at the terminal: answers once the terminal does, within 3 minutes. */
  payAtTerminal(userId: string, invoiceId: number, terminalId: string): Observable<TerminalResult> {
    return this.http.post<TerminalResult>(`${this.baseUrl}/${userId}/${invoiceId}/terminal-payment`, {terminalId});
  }

  /** Asks the terminal to stop waiting for the card: the pending payment then ends as cancelled. */
  cancelTerminalPayment(userId: string, invoiceId: number): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${userId}/${invoiceId}/terminal-payment/cancel`, {});
  }

  /** Refunds at the terminal what the payment hasn't given back yet. The refund is confirmed later. */
  refundAtTerminal(userId: string, invoiceId: number, terminalId: string): Observable<TerminalResult> {
    return this.http.post<TerminalResult>(`${this.baseUrl}/${userId}/${invoiceId}/terminal-refund`, {terminalId});
  }

  refundOnline(userId: string, invoiceId: number): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.baseUrl}/${userId}/${invoiceId}/refund`, {});
  }

  downloadPdf(userId: string, invoiceId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${userId}/${invoiceId}/pdf`, {responseType: 'blob'});
  }
}
