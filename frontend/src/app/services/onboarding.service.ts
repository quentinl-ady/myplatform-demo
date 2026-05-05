import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {OnboardingResponse} from '../models';

@Injectable({providedIn: 'root'})
export class OnboardingService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getOnboardingLink(userId: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.baseUrl}/api/onboarding/${userId}/link`);
  }

  getOnboardingStatus(userId: string): Observable<OnboardingResponse> {
    return this.http.get<OnboardingResponse>(`${this.baseUrl}/api/onboarding/${userId}/kyc-status`);
  }

  validateKyc(userId: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/onboarding/${userId}/validate-kyc`, {}, {responseType: 'json'});
  }
}
