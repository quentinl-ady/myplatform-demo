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
  bankAccountId: string;
  bankAccountNumber: string;
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

export interface PayoutAccount {
  transferInstrumentId: string;
  accountIdentifier: string;
}

export interface PayoutConfigurationPayload {
  userId: number;
  balanceAccountId: string;
  currencyCode: string;
  regular: boolean;
  instant: boolean;
  transferInstrumentId: string;
  schedule: string;
}

export interface PayoutConfiguration {
  regular: boolean;
  instant: boolean;
  accountIdentifier: string;
  balanceAccountId: string;
  currencyCode: string;
  schedule: string;
}

export interface Device {
  id: string;
  name: string;
  paymentInstrumentId: string;
  type: string;
}

export interface RegisterSCAResponse {
  id: string;
  paymentInstrumentId: string;
  sdkInput: string;
  success: boolean;
}

export interface RegisterSCAFinalResponse {
  success: boolean;
}

export interface DeleteDeviceRequest {
  id : string;
  paymentInstrumentId : string;
}

export interface InitiateTransferRequest {
  sdkOutput: string;
  amount: number;
  counterpartyBankAccount: string;
  reference: string;
  userId: number;
  transferType: string;
}

export interface InitiateTransferResponse {
  authParam1: string;
  amount: number;
  counterparty: string;
}

export interface BankAccountInformationResponse {
  currency: string;
  amount: number;
  bankAccountNumber: string;
  description: string;
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

  getPayByLinkInformation(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/paybylink/${userId}`);
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

  getPayoutAccounts(userId: number): Observable<PayoutAccount[]> {
    return this.http.get<PayoutAccount[]>(`${this.baseUrl}/payoutAccount/${userId}`);
  }

  createPayoutConfiguration(payload: PayoutConfigurationPayload): Observable<PayoutConfiguration> {
    return this.http.post<PayoutConfiguration>(`${this.baseUrl}/payoutConfiguration`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  getPayoutConfigurations(userId: number, balanceAccountId: string): Observable<PayoutConfiguration[]> {
    return this.http.get<PayoutConfiguration[]>(`${this.baseUrl}/payoutConfiguration/${userId}/${balanceAccountId}`);
  }

  validateKyc(userId: number): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/validateKyc/${userId}`, {}, { responseType: 'json' });
  }

  handleShopperRedirect(data: any): Observable<any> {
    return this.http.get(`${this.baseUrl}/handleShopperRedirect`, data);
  }

  getGooglePayJwt(hostname: string): Observable<{ googlePayJwtToken: string }> {
      return this.http.get<{ googlePayJwtToken: string }>(
        `${this.baseUrl}/gpay-jwt`,
        { params: { hostname } }
      );
    }

  listDevices(userId: number): Observable<Device[]> {
    return this.http.get<Device[]>(`${this.baseUrl}/listDevices/${userId}`);
  }

  initiateDeviceRegistration(sdkOutput: string, userId: number): Observable<RegisterSCAResponse> {
    return this.http.post<RegisterSCAResponse>(
      `${this.baseUrl}/initiateDeviceRegistration`,
      { sdkOutput, userId }
    );
  }

  finalizeRegistration(id: string, sdkOutput: string, userId: number): Observable<RegisterSCAFinalResponse> {
    return this.http.post<RegisterSCAFinalResponse>(
      `${this.baseUrl}/finalizeRegistration`,
      { id, sdkOutput, userId }
    );
  }

  deleteDevice(request: DeleteDeviceRequest): Observable<{ status: string }> {
      return this.http.post<{ status: string }>(
        `${this.baseUrl}/deleteDevice`,
        request
      );
    }

  initiateTransfer(request: InitiateTransferRequest): Observable<InitiateTransferResponse> {
      return this.http.post<InitiateTransferResponse>(
        `${this.baseUrl}/initiateTransfer`,
        request
      );
    }

  finalizeTransfer(request: InitiateTransferRequest): Observable<{ status: string }> {
        return this.http.post<{ status: string }>(
          `${this.baseUrl}/finalizeTransfer`,
          request
        );
      }

    getBankAccountInformation(userId: number): Observable<BankAccountInformationResponse> {
      return this.http.get<BankAccountInformationResponse>(
        `${this.baseUrl}/bankAccount/${userId}`
      );
    }

    getRibPdf(userId: number): Observable<Blob> {
      return this.http.get(`${this.baseUrl}/api/bankstatement/rib/pdf`, {
        params: { userId },
        responseType: 'blob'
      });
    }

}
