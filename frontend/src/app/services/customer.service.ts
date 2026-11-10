import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Customer, CustomerRequest} from '../models';

@Injectable({providedIn: 'root'})
export class CustomerService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/customers`;
  private readonly http = inject(HttpClient);

  getCustomers(userId: string): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${this.baseUrl}/${userId}`);
  }

  create(userId: string, request: CustomerRequest): Observable<Customer> {
    return this.http.post<Customer>(`${this.baseUrl}/${userId}`, request);
  }

  update(userId: string, customerId: number, request: CustomerRequest): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/${userId}/${customerId}`, request);
  }

  /** Only a customer without invoices can be deleted. */
  delete(userId: string, customerId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${userId}/${customerId}`);
  }
}
