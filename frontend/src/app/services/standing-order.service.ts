import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  StandingOrderListResponse,
  StandingOrder,
  StandingOrderCreateRequest,
  StandingOrderInitiateResponse
} from '../models/standing-order.model';

@Injectable({ providedIn: 'root' })
export class StandingOrderService {

  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  list(userId: number): Observable<StandingOrderListResponse> {
    return this.http.get<StandingOrderListResponse>(`${this.baseUrl}/api/standing-orders/${userId}`);
  }

  get(userId: number, standingOrderId: string): Observable<StandingOrder> {
    return this.http.get<StandingOrder>(`${this.baseUrl}/api/standing-orders/${userId}/${standingOrderId}`);
  }

  update(userId: number, standingOrderId: string, patch: any): Observable<StandingOrder> {
    return this.http.patch<StandingOrder>(`${this.baseUrl}/api/standing-orders/${userId}/${standingOrderId}`, patch);
  }

  delete(userId: number, standingOrderId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/standing-orders/${userId}/${standingOrderId}`);
  }

  initiate(userId: number, standingOrder: StandingOrderCreateRequest, sdkOutput: string): Observable<StandingOrderInitiateResponse> {
    return this.http.post<StandingOrderInitiateResponse>(`${this.baseUrl}/api/standing-orders/${userId}/initiate`, { standingOrder, sdkOutput });
  }

  finalize(userId: number, standingOrder: StandingOrderCreateRequest, sdkOutput: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/standing-orders/${userId}/finalize`, { standingOrder, sdkOutput });
  }
}
