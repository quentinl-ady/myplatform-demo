import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {BusinessLine} from '../models';

@Injectable({providedIn: 'root'})
export class ActivityService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getBusinessLines(userId: number): Observable<BusinessLine[]> {
    return this.http.get<BusinessLine[]>(`${this.baseUrl}/api/activities/${userId}`);
  }

  addBusinessLine(userId: number, payload: { industryCode: string; salesChannels: string[] }): Observable<BusinessLine> {
    return this.http.post<BusinessLine>(`${this.baseUrl}/api/activities/${userId}`, payload, {
      headers: {'Content-Type': 'application/json'}
    });
  }
}
