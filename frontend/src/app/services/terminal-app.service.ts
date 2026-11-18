import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {Invoice, TerminalContext, TerminalResult} from '../models';

/**
 * The endpoints of the payment terminals: the ID of the terminal stands in for a login. The terminal page may call
 * another backend than the rest of the web app, so each call takes the base URL.
 */
@Injectable({providedIn: 'root'})
export class TerminalAppService {
  private readonly http = inject(HttpClient);

  /** The store of the terminal, and the business whose invoices it collects. */
  getContext(apiBase: string, terminalId: string): Observable<TerminalContext> {
    return this.http.get<TerminalContext>(this.url(apiBase, terminalId));
  }

  /** The sent, overdue and paid invoices, the latest first. */
  getInvoices(apiBase: string, terminalId: string): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(`${this.url(apiBase, terminalId)}/invoices`);
  }

  getInvoice(apiBase: string, terminalId: string, invoiceId: number): Observable<Invoice> {
    return this.http.get<Invoice>(`${this.url(apiBase, terminalId)}/invoices/${invoiceId}`);
  }

  /** Collects the payment on the terminal: answers once the terminal does, within 3 minutes. */
  pay(apiBase: string, terminalId: string, invoiceId: number): Observable<TerminalResult> {
    // Without a body, the request needs no CORS preflight.
    return this.http.post<TerminalResult>(`${this.url(apiBase, terminalId)}/invoices/${invoiceId}/payment`, null);
  }

  /** Refunds what the refunds of the payment haven't given back yet. The refund is confirmed later. */
  refund(apiBase: string, terminalId: string, invoiceId: number): Observable<TerminalResult> {
    return this.http.post<TerminalResult>(`${this.url(apiBase, terminalId)}/invoices/${invoiceId}/refund`, null);
  }

  private url(apiBase: string, terminalId: string): string {
    return `${apiBase}/api/terminals/${encodeURIComponent(terminalId)}`;
  }
}
