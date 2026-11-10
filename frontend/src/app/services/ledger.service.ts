import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Ledger} from '../models';

@Injectable({providedIn: 'root'})
export class LedgerService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/ledger`;
  private readonly http = inject(HttpClient);

  /** The journal of the last days, today included. Read again from Adyen at each call, so it takes a few seconds. */
  getLedger(userId: string, days: number): Observable<Ledger> {
    return this.http.get<Ledger>(`${this.baseUrl}/${userId}`, {params: {days}});
  }

  /** The same journal as a CSV file, one row per line of entry. */
  exportJournal(userId: string, days: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${userId}/export`, {params: {days}, responseType: 'blob'});
  }
}
