import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {BankTransaction} from '../models';
import {environment} from '../../environments/environment';
import {
  CounterpartyVerificationResponse,
  DeleteDeviceRequest,
  Device,
  InitiateTransferRequest,
  InitiateTransferResponse,
  IsBankAccountValidRequest,
  IsCrossBorderRequest,
  RegisterSCAFinalResponse,
  RegisterSCAResponse,
  TransferDetail,
  VerifyCounterpartyNameRequest
} from '../models';

interface TransactionCache {
  transactions: BankTransaction[];
  timestamp: number;
}

@Injectable({providedIn: 'root'})
export class TransferService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private transactionCache = new Map<string, TransactionCache>();

  getCachedTransactions(userId: string): BankTransaction[] | null {
    const entry = this.transactionCache.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TransferService.CACHE_TTL_MS) {
      this.transactionCache.delete(userId);
      return null;
    }
    return entry.transactions;
  }

  setCachedTransactions(userId: string, transactions: BankTransaction[]): void {
    this.transactionCache.set(userId, { transactions, timestamp: Date.now() });
  }

  invalidateTransactionCache(userId: string): void {
    this.transactionCache.delete(userId);
  }

  getCacheTimestamp(userId: string): number | null {
    const entry = this.transactionCache.get(userId);
    return entry ? entry.timestamp : null;
  }

  listDevices(userId: string): Observable<Device[]> {
    return this.http.get<Device[]>(`${this.baseUrl}/api/transfers/${userId}/devices`);
  }

  initiateDeviceRegistration(sdkOutput: string, userId: string, deviceName: string): Observable<RegisterSCAResponse> {
    return this.http.post<RegisterSCAResponse>(`${this.baseUrl}/api/transfers/devices/register`, {sdkOutput, userId, deviceName});
  }

  finalizeRegistration(id: string, sdkOutput: string, userId: string): Observable<RegisterSCAFinalResponse> {
    return this.http.post<RegisterSCAFinalResponse>(`${this.baseUrl}/api/transfers/devices/register/finalize`, {id, sdkOutput, userId});
  }

  deleteDevice(request: DeleteDeviceRequest): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.baseUrl}/api/transfers/devices/delete`, request);
  }

  initiateTransfer(request: InitiateTransferRequest): Observable<InitiateTransferResponse> {
    return this.http.post<InitiateTransferResponse>(`${this.baseUrl}/api/transfers/initiate`, request);
  }

  finalizeTransfer(request: InitiateTransferRequest): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.baseUrl}/api/transfers/finalize`, request);
  }

  getBankAccountFormat(countryCode: string): Observable<{ bankAccountFormat: string }> {
    return this.http.get<{ bankAccountFormat: string }>(`${this.baseUrl}/api/bank-validation/format/${countryCode}`);
  }

  isCrossBorder(request: IsCrossBorderRequest): Observable<{ isCrossBorder: string }> {
    return this.http.post<{ isCrossBorder: string }>(`${this.baseUrl}/api/bank-validation/cross-border`, request);
  }

  isBankAccountValid(request: IsBankAccountValidRequest): Observable<{ isBankAccountValid: string }> {
    return this.http.post<{ isBankAccountValid: string }>(`${this.baseUrl}/api/bank-validation/validate`, request);
  }

  verifyCounterpartyName(payload: VerifyCounterpartyNameRequest): Observable<CounterpartyVerificationResponse> {
    return this.http.post<CounterpartyVerificationResponse>(`${this.baseUrl}/api/bank-validation/verify-counterparty`, payload, {
      responseType: 'json'
    });
  }

  initiateBankTransactions(userId: string, sdkOutput: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/transfers/${userId}/bank-transactions/initiate`, { sdkOutput });
  }

  finalizeBankTransactions(userId: string, sdkOutput: string, createdSince: string, createdUntil: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/transfers/${userId}/bank-transactions/finalize`, { sdkOutput, createdSince, createdUntil });
  }

  getTransferDetail(userId: string, transferId: string): Observable<TransferDetail> {
    return this.http.get<TransferDetail>(`${this.baseUrl}/api/transfers/${userId}/bank-transactions/detail/${transferId}`);
  }
}
