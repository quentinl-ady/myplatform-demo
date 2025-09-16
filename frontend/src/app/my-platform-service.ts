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
  capitalStatus?: OnboardingPart;
  bankingStatus?: OnboardingPart;
  issuingStatus?: OnboardingPart;
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

export interface User {
  id: number;
  email: string;
  legalEntityName: string;
  countryCode: string;
  userType: string;
  legalEntityId: string;
  firstName: string | null;
  lastName: string | null;
  accountHolderId: string;
  currencyCode: string;
  balanceAccountId: string;
  activityReason: string;
  bank: boolean;
  capital: boolean;
  issuing: boolean;
}

export interface BalanceAccount {
  currencyCode: string;
  description: string;
  balanceAccountId: string;
}

export interface StorePayload {
  businessLineId: string[];
  city: string;
  country: string;
  postalCode: string;
  lineAdresse1: string;
  reference: string;
  phoneNumber: string;
  balanceAccountId: string;
  paymentMethodRequest: string[]; //visa //mc //cartebancaire //amex
}

export interface Store {
  storeId: string;
  storeRef: string;
  city: string;
  country: string;
  lineAdresse: string;
  phoneNumber: string;
  balanceAccountInfoCustomer: BalanceAccount;
  paymentMethods: { type: string; verificationStatus: VerificationStatus }[];
}


export interface SendPaymentPayload {
  amount: number;
  currencyCode: string;
  storeReference: string;
  userId: number;
  reference: string;
}

export interface SendPaymentResponse {
  id: string;
  sessionData: string;
  amount: number;
  currency: string;
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

  getUserById(userId: number): Observable<User> {
    return this.http.get<User>(`${this.baseUrl}/user/${userId}`);
  }

  getBalanceAccounts(userId: number): Observable<BalanceAccount[]> {
    return this.http.get<BalanceAccount[]>(`${this.baseUrl}/accounts/${userId}`);
  }

  createStore(userId: number, payload: StorePayload): Observable<Store> {
    return this.http.post<Store>(`${this.baseUrl}/store/${userId}`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  getStores(userId: number): Observable<Store[]> {
    return this.http.get<Store[]>(`${this.baseUrl}/stores/${userId}`);
  }

  sendPayment(payload: SendPaymentPayload): Observable<SendPaymentResponse> {
    return this.http.post<SendPaymentResponse>(`${this.baseUrl}/sendPayment/`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  getClientKey(): Observable<{ key: string }> {
    return this.http.get<{ key: string }>(`${this.baseUrl}/clientKey`);
  }


}
