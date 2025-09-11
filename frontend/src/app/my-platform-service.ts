import {inject, Injectable} from '@angular/core';
import {HttpClient} from "@angular/common/http";
import {Observable} from "rxjs";


interface AuthPayload {
  email: string;
  password: string;
}

export type VerificationStatus = 'invalid' | 'pending' | 'reject' | 'valid';

export interface OnboardingPart {
  allowed: boolean;
  verificationStatus: VerificationStatus;
}

export interface OnboardingResponse {
  acquiringStatus: OnboardingPart;
  payoutStatus: OnboardingPart;
}

export interface SessionToken {
  id: string;
  token: string;
}

export interface BusinessLine {
  id:string;
  industryCode: string;
  salesChannels: string[];
}

@Injectable({
  providedIn: 'root'
})
export class MyPlatformService {
  private readonly baseUrl = 'http://localhost:8080';
  private readonly http = inject(HttpClient);


  login(payload: AuthPayload): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/login`, payload, { responseType: 'json'});
  }

  signup(payload: AuthPayload): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/signup`, payload, { responseType: 'json'});
  }

  getOnboardingLink(userId: number): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.baseUrl}/onboarding-link/${userId}`);
  }

  getOnboardingStatus(userId: number): Observable<OnboardingResponse> {
    return this.http.get<OnboardingResponse>(`${this.baseUrl}/kyc-status/${userId}`);
  }

  getPaymentInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/paymentInformation/${userId}`);
  }

  getReportInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/reportInformation/${userId}`);
  }

  getPayoutInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/payoutInformation/${userId}`);
  }

  getDisputeInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/disputeInformation/${userId}`);
  }

  getBusinessLoans(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/businessLoans/${userId}`);
  }

  getBusinessLines(userId: number): Observable<BusinessLine[]> {
    return this.http.get<BusinessLine[]>(`${this.baseUrl}/activity/${userId}`);
  }

  addBusinessLine(userId: number, payload: { industryCode: string; salesChannels: string[] }): Observable<BusinessLine> {
    return this.http.post<BusinessLine>(`${this.baseUrl}/activity/${userId}`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
  }

}
