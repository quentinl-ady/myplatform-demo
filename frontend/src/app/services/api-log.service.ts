import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiLog } from '../models';

@Injectable({ providedIn: 'root' })
export class ApiLogService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getLogs(userId?: string, method?: string): Observable<ApiLog[]> {
    const url = userId
      ? `${this.baseUrl}/api/api-logs/${userId}`
      : `${this.baseUrl}/api/api-logs`;
    if (method) {
      return this.http.get<ApiLog[]>(url, { params: { method } });
    }
    return this.http.get<ApiLog[]>(url);
  }

  clearLogs(userId?: string): Observable<void> {
    const url = userId
      ? `${this.baseUrl}/api/api-logs/${userId}`
      : `${this.baseUrl}/api/api-logs`;
    return this.http.delete<void>(url);
  }
}
