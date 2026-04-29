import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {OnboardingResponse} from '../models';

@Injectable({providedIn: 'root'})
export class OnboardingService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getOnboardingLink(userId: number): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.baseUrl}/api/onboarding/${userId}/link`);
  }

  getOnboardingStatus(userId: number): Observable<OnboardingResponse> {
    return this.http.get<OnboardingResponse>(`${this.baseUrl}/api/onboarding/${userId}/kyc-status`);
  }

  validateKyc(userId: number): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/onboarding/${userId}/validate-kyc`, {}, {responseType: 'json'});
  }
}
