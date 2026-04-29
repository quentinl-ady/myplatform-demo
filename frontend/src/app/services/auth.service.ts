import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {AuthPayload} from '../models';

@Injectable({providedIn: 'root'})
export class AuthService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly http = inject(HttpClient);

  login(payload: AuthPayload): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/auth/login`, payload, {responseType: 'json'});
  }

  signup(payload: AuthPayload): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/api/auth/signup`, payload, {responseType: 'json'});
  }
}
