import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Invoice, InvoiceRequest, InvoiceSettings} from '../models';

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

  downloadPdf(userId: string, invoiceId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${userId}/${invoiceId}/pdf`, {responseType: 'blob'});
  }
}
