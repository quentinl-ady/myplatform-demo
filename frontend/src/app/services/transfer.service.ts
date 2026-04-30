import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
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
  VerifyCounterpartyNameRequest
} from '../models';

@Injectable({providedIn: 'root'})
export class TransferService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  listDevices(userId: number): Observable<Device[]> {
    return this.http.get<Device[]>(`${this.baseUrl}/api/transfers/${userId}/devices`);
  }

  initiateDeviceRegistration(sdkOutput: string, userId: number, deviceName: string): Observable<RegisterSCAResponse> {
    return this.http.post<RegisterSCAResponse>(`${this.baseUrl}/api/transfers/devices/register`, {sdkOutput, userId, deviceName});
  }

  finalizeRegistration(id: string, sdkOutput: string, userId: number): Observable<RegisterSCAFinalResponse> {
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
}
