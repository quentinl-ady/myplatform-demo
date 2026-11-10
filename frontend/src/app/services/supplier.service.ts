import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
import {Supplier, SupplierRequest} from '../models';

@Injectable({providedIn: 'root'})
export class SupplierService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/suppliers`;
  private readonly http = inject(HttpClient);

  /** In alphabetical order. */
  getSuppliers(userId: string): Observable<Supplier[]> {
    return this.http.get<Supplier[]>(`${this.baseUrl}/${userId}`);
  }

  create(userId: string, request: SupplierRequest): Observable<Supplier> {
    return this.http.post<Supplier>(`${this.baseUrl}/${userId}`, request);
  }

  update(userId: string, supplierId: number, request: SupplierRequest): Observable<Supplier> {
    return this.http.put<Supplier>(`${this.baseUrl}/${userId}/${supplierId}`, request);
  }

  /** Takes the name the supplier's bank returned after a partial match of the Verification of Payee. */
  useVerifiedName(userId: string, supplierId: number, name: string): Observable<Supplier> {
    return this.http.put<Supplier>(`${this.baseUrl}/${userId}/${supplierId}/verified-name`, {name});
  }

  /** Only a supplier without bills can be deleted. */
  delete(userId: string, supplierId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${userId}/${supplierId}`);
  }
}
