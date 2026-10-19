import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { DeviceKind, PhoneSession, PhoneStepResponse, RemoteApprovalRequest, RemoteSession } from '../models';

/**
 * Registrations and approvals started on the computer and finished on a phone. The computer follows
 * a session by its id; the phone acts with the token of the QR code link.
 */
@Injectable({ providedIn: 'root' })
export class RemoteSessionService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/remote-sessions`;
  private readonly http = inject(HttpClient);

  // ---- Computer ----

  createPairing(userId: string, otpCode: string, deviceName: string): Observable<RemoteSession> {
    return this.http.post<RemoteSession>(`${this.baseUrl}/pairing`, { userId, otpCode, deviceName });
  }

  createApproval(request: RemoteApprovalRequest): Observable<RemoteSession> {
    return this.http.post<RemoteSession>(`${this.baseUrl}/approvals`, request);
  }

  status(userId: string, sessionId: string): Observable<RemoteSession> {
    return this.http.get<RemoteSession>(`${this.baseUrl}/${encodeURIComponent(sessionId)}`, { params: { userId } });
  }

  cancel(userId: string, sessionId: string): Observable<RemoteSession> {
    return this.http.post<RemoteSession>(`${this.baseUrl}/${encodeURIComponent(sessionId)}/cancel`, { userId });
  }

  // ---- Phone ----

  open(token: string, label: string, passkeys: boolean): Observable<PhoneSession> {
    return this.http.post<PhoneSession>(`${this.baseUrl}/phone/open`, { token, label, passkeys });
  }

  phoneStatus(token: string): Observable<PhoneSession> {
    return this.http.post<PhoneSession>(`${this.baseUrl}/phone/status`, { token });
  }

  decline(token: string): Observable<PhoneSession> {
    return this.http.post<PhoneSession>(`${this.baseUrl}/phone/decline`, { token });
  }

  register(token: string, sdkOutput: string): Observable<PhoneStepResponse> {
    return this.http.post<PhoneStepResponse>(`${this.baseUrl}/phone/register`, { token, sdkOutput });
  }

  finalizeRegistration(token: string, sdkOutput: string, kind: DeviceKind, platform: string): Observable<PhoneStepResponse> {
    return this.http.post<PhoneStepResponse>(`${this.baseUrl}/phone/register/finalize`, { token, sdkOutput, kind, platform });
  }

  associate(token: string): Observable<PhoneStepResponse> {
    return this.http.post<PhoneStepResponse>(`${this.baseUrl}/phone/associate`, { token });
  }

  finalizeAssociation(token: string, sdkOutput: string): Observable<PhoneStepResponse> {
    return this.http.post<PhoneStepResponse>(`${this.baseUrl}/phone/associate/finalize`, { token, sdkOutput });
  }

  challenge(token: string, sdkOutput: string): Observable<PhoneStepResponse> {
    return this.http.post<PhoneStepResponse>(`${this.baseUrl}/phone/challenge`, { token, sdkOutput });
  }

  approve(token: string, sdkOutput: string): Observable<PhoneStepResponse> {
    return this.http.post<PhoneStepResponse>(`${this.baseUrl}/phone/approve`, { token, sdkOutput });
  }
}
