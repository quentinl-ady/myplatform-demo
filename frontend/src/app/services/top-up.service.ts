import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { TopUpBankAccount, TopUpCapability, TopUpContext, TopUpResult, TopUpSweep, TopUpSweepRequest } from '../models/top-up.model';

@Injectable({ providedIn: 'root' })
export class TopUpService {
  private readonly http = inject(HttpClient);
  private url(userId: string): string {
    return `${environment.apiBaseUrl}/api/top-ups/${encodeURIComponent(userId)}`;
  }

  context(userId: string) {
    return this.http.get<TopUpContext>(this.url(userId));
  }

  bankAccounts(userId: string) {
    return this.http.get<TopUpBankAccount[]>(`${this.url(userId)}/bank-accounts`);
  }

  requestCapability(userId: string) {
    return this.http.post<Record<string, TopUpCapability>>(`${this.url(userId)}/capability`, {});
  }

  topUp(userId: string, request: { amount: number; transferInstrumentId: string; mandateAccepted: boolean }) {
    return this.http.post<TopUpResult>(this.url(userId), request);
  }

  createSweep(userId: string, request: TopUpSweepRequest) {
    return this.http.post<TopUpSweep>(`${this.url(userId)}/sweeps`, request);
  }

  updateSweep(userId: string, sweepId: string, active: boolean) {
    return this.http.patch<TopUpSweep>(`${this.url(userId)}/sweeps/${encodeURIComponent(sweepId)}`, { active });
  }

  deleteSweep(userId: string, sweepId: string) {
    return this.http.delete<void>(`${this.url(userId)}/sweeps/${encodeURIComponent(sweepId)}`);
  }
}
