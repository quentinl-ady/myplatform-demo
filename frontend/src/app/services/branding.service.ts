import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserBranding } from '../models';

@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  getBranding(userId: string): Observable<UserBranding | null> {
    return this.http.get<UserBranding>(`${this.baseUrl}/api/users/${userId}/branding`).pipe(
      catchError(() => of(null))
    );
  }

  updateBranding(userId: string, data: { platformName?: string; logoData?: string; logoType?: string }): Observable<UserBranding> {
    return this.http.put<UserBranding>(`${this.baseUrl}/api/users/${userId}/branding`, data);
  }

  resetBranding(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/users/${userId}/branding`);
  }
}
