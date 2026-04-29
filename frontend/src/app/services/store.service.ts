import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Store, StorePayload, TerminalResponse} from '../models';

@Injectable({providedIn: 'root'})
export class StoreService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  createStore(userId: number, payload: StorePayload): Observable<Store> {
    return this.http.post<Store>(`${this.baseUrl}/api/stores/${userId}`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }

  getStores(userId: number): Observable<Store[]> {
    return this.http.get<Store[]>(`${this.baseUrl}/api/stores/${userId}`);
  }

  listTerminals(storeId: string): Observable<TerminalResponse[]> {
    return this.http.get<TerminalResponse[]>(`${this.baseUrl}/api/stores/${storeId}/terminals`);
  }
}
