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

export interface BankAccountStatus {
  bankingEnabled: boolean;
  bankAccountCreated: boolean;
  bankingAllowed: boolean;
  bankAccountId: string | null;
  bankAccountNumber: string | null;
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
  reference: string;
  userId: number;
  transferType: string;
  counterpartyCountry: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
}

export interface InitiateTransferResponse {
  authParam1: string;
  amount: number;
  counterpartyCountry: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
}

export interface BankAccountInformationResponse {
  currency: string;
  amount: number;
  bankAccountNumber: string;
  description: string;
}

export interface IsCrossBorderRequest {
  userId: number;
  countryCodeCounterparty: string;
}

export interface IsBankAccountValidRequest {
  transferType: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
  bankAccountFormat: string;
}

export interface VerifyCounterpartyNameRequest {
  accountHolderName: string;
  iban: string;
  reference: string;
  accountNumber: string;
  sortCode: string;
  accountType: string;
  transferType: string;
  counterpartyCountry: string;
}

export interface CounterpartyVerificationResponse {
  name: string;
  response: string;
  responseDescription: string;
}

export interface PosPaymentRequest {
  reference: string;
  amount: number;
  currency: string;
  terminalId: string;
}

export interface PosPaymentResponse {
  status: string; //ERROR //SUCCESS //FAILURE
  pspReference: string;
  cardBrand: string;
  maskedPan: string;
  errorCondition: string;
  refusalReason: string;
  reference: string;
}

export interface TerminalResponse {
  id: string;
  status: string;
  model: string;
}

// Issuing interfaces
export interface TransactionRuleRequest {
  type: string; // maxTransactions, maxAmountPerTransaction, maxTotalAmount, blockedMccs
  value?: number;
  currencyCode?: string;
  blockedMccs?: string[];
}

export interface CreateCardRequest {
  userId: number;
  cardholderName: string;
  brand: string; // visa or mc
  email?: string;
  phone?: string;
  transactionRules?: TransactionRuleRequest[];
}

export interface PhonePrefix {
  code: string;
  country: string;
  flag: string;
}

export interface TransactionRuleResponse {
  id: string;
  type: string;
  value?: number;
  currencyCode?: string;
  status: string;
  blockedMccs?: string[];
}

export interface CardResponse {
  paymentInstrumentId: string;
  cardholderName: string;
  brand: string;
  brandVariant: string;
  lastFour: string;
  expiryMonth: string;
  expiryYear: string;
  status: string;
  transactionRules: TransactionRuleResponse[];
}

export interface AddTransactionRuleRequest {
  paymentInstrumentId: string;
  type: string;
  value?: number;
  currencyCode?: string;
  blockedMccs?: string[];
}

// Card Transfers
export interface CardTransferValidationFact {
  type: string;
  result: string;
}

export interface CardTransferEvent {
  id: string;
  status: string;
  bookingDate: string;
  type: string;
  amountValue: number;
  amountCurrency: string;
  originalAmountValue: number;
  originalAmountCurrency: string;
}

export interface CardTransferTriggeredRule {
  reason: string;
  ruleDescription: string;
  ruleId: string;
  outcomeType: string;
}

export interface CardTransferRulesResult {
  advice: string;
  allHardBlockRulesPassed: boolean;
  score: number;
  triggeredRules: CardTransferTriggeredRule[];
}

export interface CardTransfer {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  type: string;
  reason: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  sequenceNumber: number;
  paymentInstrumentId: string;
  paymentInstrumentDescription: string;
  processingType: string;
  panEntryMode: string;
  authorisationType: string;
  threeDSecureAcsTransactionId: string;
  merchantName: string;
  merchantCity: string;
  merchantCountry: string;
  mcc: string;
  validationFacts: CardTransferValidationFact[];
  events: CardTransferEvent[];
  transactionRulesResult: CardTransferRulesResult;
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

  getExternalBankAccountSession(userId: string): Observable<SessionToken> {
    return this.http.get<SessionToken>(`${this.baseUrl}/external-bank-account/${userId}`);
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

  createBankAccount(userId: number): Observable<{ bankAccountId: string; bankAccountNumber: string }> {
    return this.http.post<{ bankAccountId: string; bankAccountNumber: string }>(`${this.baseUrl}/api/users/${userId}/create-bank-account`, {});
  }

  getBankAccountStatus(userId: number): Observable<BankAccountStatus> {
    return this.http.get<BankAccountStatus>(`${this.baseUrl}/api/users/${userId}/bank-account-status`);
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

  getBankAccountFormat(countryCode: string): Observable<{ bankAccountFormat: string }> {
      return this.http.get<{ bankAccountFormat: string }>(
        `${this.baseUrl}/bankAccountFormat/country/${countryCode}`
      );
    }

  isCrossBorder(request: IsCrossBorderRequest): Observable<{ isCrossBorder: string }> {
      return this.http.post<{ isCrossBorder: string }>(
        `${this.baseUrl}/isCrossBorder/`,
        request
      );
    }

  isBankAccountValid(request: IsBankAccountValidRequest): Observable<{ isBankAccountValid: string }> {
      return this.http.post<{ isBankAccountValid: string }>(
        `${this.baseUrl}/isBankAccountValid`,
        request
      );
    }

  verifyCounterpartyName(payload: VerifyCounterpartyNameRequest): Observable<CounterpartyVerificationResponse> {
      return this.http.post<CounterpartyVerificationResponse>(
        `${this.baseUrl}/verifyCounterpartyName`,
        payload,
        { responseType: 'json' }
      );
    }

  makePosPayment(payload: PosPaymentRequest): Observable<PosPaymentResponse> {
      return this.http.post<PosPaymentResponse>(
        `${this.baseUrl}/pos/pay`,
        payload,
        { responseType: 'json' }
      );
    }

  listTerminals(storeId: string): Observable<TerminalResponse[]> {
      return this.http.get<TerminalResponse[]>(`${this.baseUrl}/listTerminal/storeId/${storeId}`);
    }

  // Issuing - Cards
  createCard(request: CreateCardRequest): Observable<CardResponse> {
    return this.http.post<CardResponse>(`${this.baseUrl}/issuing/cards`, request);
  }

  getPhonePrefixes(): Observable<PhonePrefix[]> {
    return this.http.get<PhonePrefix[]>(`${this.baseUrl}/issuing/phone-prefixes`);
  }

  getCards(userId: number, status?: string): Observable<CardResponse[]> {
    const params = status ? `?status=${status}` : '';
    return this.http.get<CardResponse[]>(`${this.baseUrl}/issuing/cards/${userId}${params}`);
  }

  getCardDetails(paymentInstrumentId: string): Observable<CardResponse> {
    return this.http.get<CardResponse>(`${this.baseUrl}/issuing/card/${paymentInstrumentId}`);
  }

  updateCardStatus(paymentInstrumentId: string, status: string): Observable<{ status: string; newStatus: string }> {
    return this.http.put<{ status: string; newStatus: string }>(`${this.baseUrl}/issuing/cards/status`, {
      paymentInstrumentId,
      status
    });
  }

  // Issuing - Transaction Rules
  addTransactionRule(request: AddTransactionRuleRequest): Observable<{ ruleId: string; status: string }> {
    return this.http.post<{ ruleId: string; status: string }>(`${this.baseUrl}/issuing/rules`, request);
  }

  getTransactionRules(paymentInstrumentId: string): Observable<TransactionRuleResponse[]> {
    return this.http.get<TransactionRuleResponse[]>(`${this.baseUrl}/issuing/rules/${paymentInstrumentId}`);
  }

  updateTransactionRule(ruleId: string, status: string): Observable<{ status: string }> {
    return this.http.put<{ status: string }>(`${this.baseUrl}/issuing/rules/${ruleId}`, { status });
  }

  deleteTransactionRule(ruleId: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.baseUrl}/issuing/rules/${ruleId}`);
  }

  // Issuing - Reveal Card Data (all crypto handled server-side)
  revealCardData(paymentInstrumentId: string): Observable<{ cardData: string }> {
    return this.http.post<{ cardData: string }>(`${this.baseUrl}/issuing/reveal`, {
      paymentInstrumentId
    });
  }

  // Issuing - Card Transfers
  getCardTransfers(userId: number, paymentInstrumentId?: string): Observable<CardTransfer[]> {
    let params = `?userId=${userId}`;
    if (paymentInstrumentId) {
      params += `&paymentInstrumentId=${paymentInstrumentId}`;
    }
    return this.http.get<CardTransfer[]>(`${this.baseUrl}/issuing/transfers${params}`);
  }

}
