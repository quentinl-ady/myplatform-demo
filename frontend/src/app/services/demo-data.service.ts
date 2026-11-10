import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {DemoDataResult} from '../models';

@Injectable({providedIn: 'root'})
export class DemoDataService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/demo-data`;
  private readonly http = inject(HttpClient);

  /** Creates what's missing: loading the demo data again doesn't duplicate it. */
  load(userId: string): Observable<DemoDataResult> {
    return this.http.post<DemoDataResult>(`${this.baseUrl}/${userId}`, {});
  }
}

/** "Demo data loaded: 4 customers, 6 invoices, 1 subscription, 4 suppliers and 4 bills, with 4 payment links." */
export function demoDataSummary(result: DemoDataResult): string {
  const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;
  const created: string[] = [];
  if (result.customersCreated) created.push(count(result.customersCreated, 'customer'));
  if (result.invoicesCreated) created.push(count(result.invoicesCreated, 'invoice'));
  if (result.subscriptionsCreated) created.push(count(result.subscriptionsCreated, 'subscription'));
  if (result.suppliersCreated) created.push(count(result.suppliersCreated, 'supplier'));
  if (result.billsCreated) created.push(count(result.billsCreated, 'bill'));
  if (!created.length) {
    return 'The demo data is already loaded.';
  }
  const list = created.length > 1 ? `${created.slice(0, -1).join(', ')} and ${created[created.length - 1]}` : created[0];
  const links = result.paymentLinksCreated ? `, with ${count(result.paymentLinksCreated, 'payment link')}` : '';
  return `Demo data loaded: ${list}${links}.`;
}
