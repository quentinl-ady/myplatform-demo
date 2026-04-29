import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';

import { MaterialModule } from '../material.module';
import { Store, StorePayload, BusinessLine, BalanceAccount } from '../models';
import { AccountService, ActivityService, StoreService } from '../services';
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
    MatStepperModule
  ],
  templateUrl: './store.component.html',
  styleUrl: './store.component.css'
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
  private accountService = inject(AccountService);
  private activityService = inject(ActivityService);
  private storeService = inject(StoreService);
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
    this.storeService.getStores(this.userId).subscribe({
      next: res => this.stores.set(res),
      error: () => this.snack.open('Error loading stores', 'Close', { duration: 3000 })
    });
  }

  loadBalanceAccounts() {
    this.accountService.getBalanceAccounts(this.userId).subscribe({
      next: res => this.balanceAccounts.set(res),
      error: () => this.snack.open('Error loading balance accounts', 'Close', { duration: 3000 })
    });
  }

  loadBusinessLines() {
    this.activityService.getBusinessLines(this.userId).subscribe({
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

    this.storeService.createStore(this.userId, payload).subscribe({
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
