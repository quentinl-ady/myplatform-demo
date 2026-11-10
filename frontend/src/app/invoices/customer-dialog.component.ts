import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Customer, CustomerRequest } from '../models';
import { CustomerService } from '../services';
import { InlineAlertComponent, httpErrorMessage } from '../shared';
import { customerCountries } from './invoice-view';

export interface CustomerDialogData {
  userId: string;
  /** Edits this customer; creates one otherwise. */
  customer?: Customer;
  /** The country of a new customer. */
  defaultCountry?: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Creates or edits a customer. Closes with the saved customer. */
@Component({
  selector: 'app-customer-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatProgressSpinnerModule, InlineAlertComponent],
  template: `
    <h2 mat-dialog-title class="dialog-title">{{ editing ? 'Edit customer' : 'New customer' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="customer-form" class="dialog-form" (ngSubmit)="submit()" novalidate>
        <div class="field-row">
          <div class="field">
            <label for="customer-company">Company <span class="optional">(optional)</span></label>
            <input id="customer-company" class="fintech-input" formControlName="company" autocomplete="organization" maxlength="100" />
          </div>
          <div class="field">
            <label for="customer-name">{{ form.get('company')?.value ? 'Contact name' : 'Name' }}</label>
            <input id="customer-name" class="fintech-input" formControlName="name" autocomplete="name" maxlength="100"
                   [attr.aria-invalid]="!!errorOf('name')"
                   [attr.aria-describedby]="errorOf('name') ? 'customer-name-error' : null" />
            <span class="helper-text error" id="customer-name-error" *ngIf="errorOf('name') as error">{{ error }}</span>
          </div>
        </div>

        <div class="field">
          <label for="customer-email">Email address</label>
          <input id="customer-email" type="email" class="fintech-input" formControlName="email" autocomplete="email" maxlength="254"
                 [attr.aria-invalid]="!!errorOf('email')"
                 [attr.aria-describedby]="errorOf('email') ? 'customer-email-error' : 'customer-email-help'" />
          <span class="helper-text error" id="customer-email-error" *ngIf="errorOf('email') as error">{{ error }}</span>
          <span class="helper-text" id="customer-email-help" *ngIf="!errorOf('email')">Prefilled on the payment page.</span>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="customer-country">Country</label>
            <select id="customer-country" class="fintech-input" formControlName="country" autocomplete="country"
                    [attr.aria-invalid]="!!errorOf('country')"
                    [attr.aria-describedby]="errorOf('country') ? 'customer-country-error' : null">
              <option value="" disabled>Choose a country</option>
              <option *ngFor="let c of countries" [value]="c.code">{{ c.name }}</option>
            </select>
            <span class="helper-text error" id="customer-country-error" *ngIf="errorOf('country') as error">{{ error }}</span>
          </div>
          <div class="field">
            <label for="customer-vat">VAT or tax ID <span class="optional">(optional)</span></label>
            <input id="customer-vat" class="fintech-input" formControlName="vatNumber" maxlength="30" autocapitalize="characters" />
          </div>
        </div>

        <div class="field">
          <label for="customer-address">Address <span class="optional">(optional)</span></label>
          <input id="customer-address" class="fintech-input" formControlName="addressLine" autocomplete="street-address" maxlength="200" />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="customer-postal-code">Postal code <span class="optional">(optional)</span></label>
            <input id="customer-postal-code" class="fintech-input" formControlName="postalCode" autocomplete="postal-code" maxlength="20" />
          </div>
          <div class="field">
            <label for="customer-city">City <span class="optional">(optional)</span></label>
            <input id="customer-city" class="fintech-input" formControlName="city" autocomplete="address-level2" maxlength="100" />
          </div>
        </div>

        <app-inline-alert *ngIf="error() as message" [title]="editing ? 'Unable to save the customer' : 'Unable to create the customer'"
                          [dismissible]="true" (dismiss)="error.set(null)">{{ message }}</app-inline-alert>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="dialog-actions">
      <button type="button" class="dialog-btn secondary" mat-dialog-close [disabled]="submitting()">Cancel</button>
      <button type="submit" form="customer-form" class="dialog-btn" [disabled]="submitting()">
        <mat-spinner *ngIf="submitting()" diameter="16" aria-hidden="true"></mat-spinner>
        <span>{{ submitting() ? 'Saving…' : (editing ? 'Save customer' : 'Add customer') }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../checkout/advanced-options/form-fields.css', './dialog.css'],
})
export class CustomerDialogComponent {
  private readonly data: CustomerDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CustomerDialogComponent, Customer>>(MatDialogRef);
  private readonly customerService = inject(CustomerService);
  private readonly fb = inject(FormBuilder);

  readonly editing = !!this.data.customer;
  readonly countries = customerCountries(this.data.customer?.country, this.data.defaultCountry);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly form: FormGroup;

  constructor() {
    const customer = this.data.customer;
    this.form = this.fb.group({
      company: [customer?.company ?? ''],
      name: [customer?.name ?? '', Validators.required],
      email: [customer?.email ?? '', [Validators.required, Validators.pattern(EMAIL)]],
      country: [customer?.country ?? this.data.defaultCountry ?? '', Validators.required],
      vatNumber: [customer?.vatNumber ?? ''],
      addressLine: [customer?.addressLine ?? ''],
      postalCode: [customer?.postalCode ?? ''],
      city: [customer?.city ?? ''],
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null));
  }

  errorOf(name: 'name' | 'email' | 'country'): string | null {
    const control = this.form.get(name);
    if (!control || control.valid || !(control.touched || control.dirty)) return null;
    switch (name) {
      case 'name':
        return 'Enter the name of the customer.';
      case 'email':
        return 'Enter a valid email address, like name@example.com.';
      default:
        return 'Choose the country of the customer.';
    }
  }

  submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document.querySelector<HTMLElement>('#customer-form [aria-invalid="true"]')?.focus();
      return;
    }
    const value = this.form.value;
    const request: CustomerRequest = {
      name: value.name,
      company: value.company || null,
      email: value.email,
      country: value.country,
      vatNumber: value.vatNumber || null,
      addressLine: value.addressLine || null,
      postalCode: value.postalCode || null,
      city: value.city || null,
    };
    const customer = this.data.customer;
    this.error.set(null);
    this.submitting.set(true);
    this.dialogRef.disableClose = true;
    const save$ = customer
      ? this.customerService.update(this.data.userId, customer.id, request)
      : this.customerService.create(this.data.userId, request);
    save$.subscribe({
      next: saved => this.dialogRef.close(saved),
      error: err => {
        this.error.set(httpErrorMessage(err, 'Unable to save the customer. Try again.'));
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
      }
    });
  }
}
