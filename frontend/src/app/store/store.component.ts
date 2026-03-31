import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MaterialModule } from '../material.module';
import { MyPlatformService, Store, StorePayload, BusinessLine, BalanceAccount } from '../my-platform-service';
import { INDUSTRY_CODES } from "../industry-codes";

export const PAYMENT_METHODS = [
  { key: 'visa', label: 'Visa' },
  { key: 'mc', label: 'Mastercard' },
  { key: 'cartebancaire', label: 'Carte Bancaire' },
  { key: 'amex', label: 'American Express' },
  { key: 'googlepay', label: 'Google Pay' }
];

const COUNTRY_SUGGESTIONS: Record<string, { city: string; postal: string; phone: string, lineAdresse1: string }> = {
  FR: { city: 'Paris', postal: '75001', phone: '+33123456789', lineAdresse1: '6 Bd Haussmann' },
  UK: { city: 'London', postal: 'EC1A1BB', phone: '+442012345678', lineAdresse1: '12-13 Wells Mews' },
  DE: { city: 'Berlin', postal: '10115', phone: '+493012345678', lineAdresse1: 'Jägerstraße 27' },
  US: { city: 'Washington', postal: '20001', phone: '+12021234567', lineAdresse1: '71 5th Avenue' },
  NL: { city: 'Amsterdam', postal: '1011AB', phone: '+31201234567', lineAdresse1: 'Rokin 49' }
};

@Component({
  selector: 'app-store',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule,
    MatSnackBarModule,
    MatStepperModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="fintech-wrapper">

      <div class="header-section">
        <h2>Stores Management</h2>
        <p>Manage your physical or digital storefronts and configure their payment methods.</p>
      </div>

      <div class="stores-list-container" *ngIf="stores().length; else noStores">
        <h3 class="section-title">Your Stores</h3>

        <mat-card *ngFor="let s of stores()" class="store-card">
          <div class="store-card-header">
            <div class="store-title-area">
              <div class="store-icon">
                <mat-icon>storefront</mat-icon>
              </div>
              <div class="store-title-info">
                <h4>{{ s.storeRef }}</h4>
                <p class="store-location">{{ s.city }}, {{ s.country }}</p>
              </div>
            </div>
            <div class="balance-info">
              <span class="label">Balance Account</span>
              <strong>{{ s.balanceAccountInfoCustomer.description }} ({{ s.balanceAccountInfoCustomer.currencyCode }})</strong>
            </div>
          </div>

          <div class="store-card-body">
            <div class="info-grid">
              <div class="info-item">
                <span class="label">Address</span>
                <span>{{ s.lineAdresse }}</span>
              </div>
              <div class="info-item">
                <span class="label">Phone</span>
                <span>{{ s.phoneNumber }}</span>
              </div>
            </div>

            <div class="pm-section">
              <span class="label">Payment Methods</span>
              <div class="pm-badges-container">
                <span *ngFor="let pm of s.paymentMethods" class="pm-badge" [ngClass]="pm.verificationStatus">
                  {{ pm.type | titlecase }}
                  <span class="pm-status-icon">{{ getStatusIcon(pm.verificationStatus) }}</span>
                </span>
              </div>
            </div>
          </div>
        </mat-card>
      </div>
      <ng-template #noStores>
        <mat-card class="empty-state">
          <div class="empty-icon-wrapper">
            <mat-icon>store_mall_directory</mat-icon>
          </div>
          <h3>No stores found</h3>
          <p>You haven't created any stores yet. Add your first store below to start processing payments.</p>
        </mat-card>
      </ng-template>

      <mat-card class="add-store-card">
        <h3 class="card-title">Add a New Store</h3>

        <mat-vertical-stepper [linear]="true" #stepper class="fintech-stepper">

          <mat-step [stepControl]="generalForm">
            <form [formGroup]="generalForm">
              <ng-template matStepLabel>General Information</ng-template>

              <div class="form-grid">
                <div class="form-group">
                  <label>Store Reference</label>
                  <input type="text" class="fintech-input" formControlName="reference" placeholder="e.g. Paris-HQ" />
                </div>

                <div class="form-group">
                  <label>Country</label>
                  <select class="fintech-input" formControlName="country" (change)="onCountryChange($event)">
                    <option value="" disabled selected>Select a country</option>
                    <option value="FR">France</option>
                    <option value="UK">United Kingdom</option>
                    <option value="NL">Netherlands</option>
                    <option value="DE">Germany</option>
                    <option value="US">United States</option>
                  </select>
                </div>

                <div class="form-group">
                  <label>City</label>
                  <input type="text" class="fintech-input" formControlName="city" />
                </div>

                <div class="form-group">
                  <label>Postal Code</label>
                  <input type="text" class="fintech-input" formControlName="postalCode" />
                </div>

                <div class="form-group full-width-grid">
                  <label>Address Line 1</label>
                  <input type="text" class="fintech-input" formControlName="lineAdresse1" />
                </div>

                <div class="form-group">
                  <label>Phone Number</label>
                  <input type="text" class="fintech-input" formControlName="phoneNumber" />
                </div>

                <div class="form-group">
                  <label>Balance Account</label>
                  <select class="fintech-input" formControlName="balanceAccountId">
                    <option value="" disabled selected>Select account</option>
                    <option *ngFor="let b of balanceAccounts()" [value]="b.balanceAccountId">
                      {{ b.description }} ({{ b.currencyCode }})
                    </option>
                  </select>
                </div>
              </div>

              <div class="stepper-actions">
                <button mat-flat-button class="fintech-btn primary" matStepperNext [disabled]="generalForm.invalid">
                  Next Step
                </button>
              </div>
            </form>
          </mat-step>

          <mat-step [stepControl]="activityForm">
            <form [formGroup]="activityForm">
              <ng-template matStepLabel>Business Activity</ng-template>

              <div class="form-group">
                <label>Business Activity Profiles</label>
                <select multiple class="fintech-input multiple-select" formControlName="businessLineIds">
                  <option *ngFor="let bl of businessLines()" [value]="bl.id">
                    {{ getIndustryLabel(bl.industryCode) }} ({{ bl.salesChannels.join(', ') }})
                  </option>
                </select>
                <span class="helper-text">Hold Ctrl (or Cmd) to select multiple activities.</span>
              </div>

              <div class="stepper-actions split">
                <button mat-stroked-button class="fintech-btn secondary" matStepperPrevious>Back</button>
                <button mat-flat-button class="fintech-btn primary" matStepperNext [disabled]="activityForm.invalid">
                  Next Step
                </button>
              </div>
            </form>
          </mat-step>

          <mat-step [stepControl]="paymentsForm">
            <form [formGroup]="paymentsForm">
              <ng-template matStepLabel>Payment Methods</ng-template>

              <div class="form-group">
                <label>Select accepted payment methods for this store</label>
                <div class="checkbox-grid">
                  <div class="pm-checkbox-card" *ngFor="let p of PAYMENT_METHODS">
                    <mat-checkbox formControlName="{{ p.key }}" color="primary">
                      <div class="pm-label-content">
                        <strong>{{ p.label }}</strong>
                        <span class="pm-fee">10% commission</span>
                      </div>
                    </mat-checkbox>
                  </div>
                </div>
              </div>

              <div class="stepper-actions split">
                <button mat-stroked-button class="fintech-btn secondary" matStepperPrevious>Back</button>
                <button mat-flat-button class="fintech-btn primary" (click)="submitCreate(stepper)" [disabled]="paymentsForm.invalid || isSubmitting">
                  <span *ngIf="!isSubmitting">Create Store</span>
                  <mat-spinner *ngIf="isSubmitting" diameter="20" color="accent"></mat-spinner>
                </button>
              </div>
            </form>
          </mat-step>

        </mat-vertical-stepper>
      </mat-card>

    </div>
  `,
  styles: [`
    :host {
      --fintech-primary: #000000;
      --fintech-bg: #f5f6f8;
      --fintech-surface: #ffffff;
      --fintech-text: #1a1a1a;
      --fintech-text-secondary: #737373;
      --fintech-border: #e5e5e5;
      --fintech-radius: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper {
      max-width: 720px;
      margin: 40px auto;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    /* Header */
    .header-section {
      text-align: left;
    }
    .header-section h2 {
      font-size: 28px;
      font-weight: 700;
      color: var(--fintech-text);
      margin: 0 0 8px 0;
      letter-spacing: -0.5px;
    }
    .header-section p {
      color: var(--fintech-text-secondary);
      font-size: 15px;
      margin: 0;
    }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--fintech-text);
      margin: 0 0 16px 0;
    }

    mat-card {
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
      padding: 24px;
    }
    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 20px 0;
      color: var(--fintech-text);
    }

    /* Store Cards */
    .stores-list-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .store-card {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .store-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid var(--fintech-border);
      padding-bottom: 16px;
    }
    .store-title-area {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .store-icon {
      width: 48px;
      height: 48px;
      background: var(--fintech-bg);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--fintech-text);
    }
    .store-title-info h4 {
      margin: 0 0 4px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .store-location {
      margin: 0;
      font-size: 13px;
      color: var(--fintech-text-secondary);
    }
    .balance-info {
      text-align: right;
      display: flex;
      flex-direction: column;
    }
    .balance-info .label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--fintech-text-secondary);
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .store-card-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
      font-size: 13px;
    }
    .info-item .label {
      color: var(--fintech-text-secondary);
      margin-bottom: 2px;
    }

    .pm-section .label {
      font-size: 12px;
      color: var(--fintech-text-secondary);
      display: block;
      margin-bottom: 8px;
    }
    .pm-badges-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pm-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background-color: var(--fintech-bg);
      color: var(--fintech-text);
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--fintech-border);
    }
    .pm-status-icon {
      font-size: 10px;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .empty-icon-wrapper {
      width: 64px;
      height: 64px;
      background: var(--fintech-bg);
      color: var(--fintech-text-secondary);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .empty-state h3 { margin: 0 0 8px 0; font-size: 18px; font-weight: 600; }
    .empty-state p { margin: 0; font-size: 14px; color: var(--fintech-text-secondary); max-width: 300px; }

    /* Forms */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    .full-width-grid {
      grid-column: 1 / -1;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--fintech-text-secondary);
      margin-bottom: 8px;
    }
    .fintech-input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid var(--fintech-border);
      border-radius: 10px;
      font-size: 15px;
      box-sizing: border-box;
      background: var(--fintech-surface);
      transition: border-color 0.2s;
    }
    select.fintech-input {
      appearance: none;
    }
    .fintech-input.multiple-select {
      height: 120px;
      padding: 8px;
    }
    .fintech-input.multiple-select option {
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 2px;
    }
    .fintech-input:focus {
      outline: none;
      border-color: var(--fintech-primary);
    }
    .helper-text {
      font-size: 11px;
      color: var(--fintech-text-secondary);
      margin-top: 6px;
      display: block;
    }

    /* Checkboxes grid */
    .checkbox-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 12px;
    }
    .pm-checkbox-card {
      border: 1px solid var(--fintech-border);
      border-radius: 10px;
      padding: 12px;
      transition: background 0.2s;
    }
    .pm-checkbox-card:hover {
      background: var(--fintech-bg);
    }
    .pm-label-content {
      display: flex;
      flex-direction: column;
      margin-left: 8px;
    }
    .pm-label-content strong {
      font-size: 14px;
      font-weight: 600;
    }
    .pm-fee {
      font-size: 11px;
      color: var(--fintech-text-secondary);
    }

    /* Stepper & Buttons */
    ::ng-deep .fintech-stepper .mat-step-header {
      border-radius: 8px;
    }
    .stepper-actions {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--fintech-border);
    }
    .stepper-actions.split {
      display: flex;
      justify-content: space-between;
    }

    .fintech-btn {
      border-radius: 24px !important;
      padding: 8px 24px !important;
      font-weight: 600 !important;
      letter-spacing: 0 !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .fintech-btn.primary {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }
    .fintech-btn.secondary {
      border-color: var(--fintech-border) !important;
      color: var(--fintech-text) !important;
    }

    @media (max-width: 600px) {
      .form-grid, .checkbox-grid, .info-grid {
        grid-template-columns: 1fr;
      }
      .store-card-header {
        flex-direction: column;
        gap: 12px;
      }
      .balance-info {
        text-align: left;
      }
    }
  `]
})
export class StoreComponent implements OnInit {
  userId = 0;
  isSubmitting = false;

  readonly PAYMENT_METHODS = PAYMENT_METHODS;

  readonly stores = signal<Store[]>([]);
  readonly balanceAccounts = signal<BalanceAccount[]>([]);
  readonly businessLines = signal<BusinessLine[]>([]);

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private auth = inject(MyPlatformService);
  private snack = inject(MatSnackBar);

  generalForm = this.fb.group({
    country: ['', Validators.required],
    city: ['', Validators.required],
    postalCode: ['', Validators.required],
    lineAdresse1: ['', Validators.required],
    reference: ['', Validators.required],
    phoneNumber: ['', Validators.required],
    balanceAccountId: ['', Validators.required]
  });

  activityForm = this.fb.group({
    businessLineIds: this.fb.control<string[]>([], Validators.required)
  });

  paymentsForm = this.fb.group(
    PAYMENT_METHODS.reduce((acc, p) => {
      acc[p.key] = [false];
      return acc;
    }, {} as Record<string, any>),
    { validators: [this.atLeastOneSelected()] }
  );

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = Number(params.get('id')) || 0;
      if (this.userId) {
        this.loadStores();
        this.loadBalanceAccounts();
        this.loadBusinessLines();
      }
    });
  }

  loadStores() {
    this.auth.getStores(this.userId).subscribe({
      next: res => this.stores.set(res),
      error: () => this.snack.open('Error loading stores', 'Close', { duration: 3000 })
    });
  }

  loadBalanceAccounts() {
    this.auth.getBalanceAccounts(this.userId).subscribe({
      next: res => this.balanceAccounts.set(res),
      error: () => this.snack.open('Error loading balance accounts', 'Close', { duration: 3000 })
    });
  }

  loadBusinessLines() {
    this.auth.getBusinessLines(this.userId).subscribe({
      next: res => this.businessLines.set(res),
      error: () => this.snack.open('Error loading business lines', 'Close', { duration: 3000 })
    });
  }

  onCountryChange(event: any) {
    const country = event.target.value;
    this.applySuggestions(country);
  }

  applySuggestions(country: string) {
    const s = COUNTRY_SUGGESTIONS[country];
    if (s) {
      this.generalForm.patchValue({
        city: s.city,
        postalCode: s.postal,
        phoneNumber: s.phone,
        lineAdresse1: s.lineAdresse1
      });
    }
  }

  sanitizeReference(ref: string): string {
    const clean = ref.replace(/[^a-zA-Z0-9]/g, '');
    const suffix = Math.random().toString(36).substring(2, 9).toUpperCase();
    return `${clean}_${suffix}`;
  }

  atLeastOneSelected() {
    return (form: any) => {
      const valid = PAYMENT_METHODS.some(p => form.get(p.key)?.value);
      return valid ? null : { required: true };
    };
  }

  getIndustryLabel(code: string): string {
    const ind = INDUSTRY_CODES.find(i => i.code === code);
    return ind ? ind.label : code;
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'valid': return '✅';
      case 'invalid': return '❌';
      case 'pending': return '⏳';
      case 'reject': return '🚫';
      default: return '';
    }
  }

  submitCreate(stepper: any) {
    if (this.generalForm.invalid || this.activityForm.invalid || this.paymentsForm.invalid) return;

    this.isSubmitting = true;
    const general = this.generalForm.value;
    const activity = this.activityForm.value;
    const payments = this.paymentsForm.value;

    const selectedPayments = PAYMENT_METHODS.filter(p => payments[p.key]).map(p => p.key);

    const payload: StorePayload = {
      businessLineId: activity.businessLineIds || [],
      city: general.city || '',
      country: general.country || '',
      postalCode: general.postalCode || '',
      lineAdresse1: general.lineAdresse1 || '',
      reference: this.sanitizeReference(general.reference || ''),
      phoneNumber: general.phoneNumber || '',
      balanceAccountId: general.balanceAccountId || '',
      paymentMethodRequest: selectedPayments
    };

    this.auth.createStore(this.userId, payload).subscribe({
      next: res => {
        this.stores.set([...this.stores(), res]);
        this.snack.open('Store created successfully', 'Close', { duration: 3000 });
        this.generalForm.reset();
        this.activityForm.reset({ businessLineIds: [] });
        for (const p of PAYMENT_METHODS) this.paymentsForm.get(p.key)?.setValue(false);
        stepper.reset();
        this.isSubmitting = false;
      },
      error: () => {
        this.snack.open('Error creating store', 'Close', { duration: 3000 });
        this.isSubmitting = false;
      }
    });
  }
}
