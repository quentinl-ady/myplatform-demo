import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';

import { MaterialModule } from '../material.module';
import { Store, StorePayload, BusinessLine, BalanceAccount, VerificationStatus } from '../models';
import { AccountService, ActivityService, StoreService } from '../services';
import { INDUSTRY_CODES } from "../industry-codes";
import { httpErrorMessage } from '../shared';

export interface PaymentMethodDef {
  key: string;
  label: string;
}

export interface VerificationStatusView {
  label: string;
  icon: string;
  cls: string;
}

const COMMON_PAYMENT_METHODS: PaymentMethodDef[] = [
  { key: 'visa', label: 'Visa' },
  { key: 'mc', label: 'Mastercard' },
  { key: 'amex', label: 'American Express' },
  { key: 'googlepay', label: 'Google Pay' }
];

const COUNTRY_PAYMENT_METHODS: Record<string, PaymentMethodDef[]> = {
  FR: [
    { key: 'cartebancaire', label: 'Cartes Bancaires' },
    { key: 'klarna_b2b', label: 'Billie' },
    { key: 'paybybank', label: 'Pay by Bank EU' },
    { key: 'sepadirectdebit', label: 'SEPA Direct Debit' }
  ],
  GB: [
    { key: 'paybybank', label: 'Pay by Bank EU' },
    { key: 'klarna_b2b', label: 'Billie' }
  ],
  US: [
    { key: 'accel', label: 'Accel' },
    { key: 'nyce', label: 'NYCE' },
    { key: 'maestro_usa', label: 'Maestro USA' },
    { key: 'paybybank_plaid', label: 'Pay by Bank US' }
  ],
  DE: [
    { key: 'girocard', label: 'Girocard' },
    { key: 'paybybank', label: 'Pay by Bank EU' },
    { key: 'klarna_b2b', label: 'Billie' },
    { key: 'sepadirectdebit', label: 'SEPA Direct Debit' }
  ],
  NL: [
    { key: 'ideal', label: 'iDEAL' },
    { key: 'klarna_b2b', label: 'Billie' },
    { key: 'sepadirectdebit', label: 'SEPA Direct Debit' }
  ]
};

const COUNTRY_LABELS: Record<string, string> = {
  FR: 'France',
  GB: 'United Kingdom',
  DE: 'Germany',
  US: 'United States',
  NL: 'Netherlands'
};

const COUNTRY_SUGGESTIONS: Record<string, { city: string; postal: string; phone: string, lineAdresse1: string }> = {
  FR: { city: 'Paris', postal: '75001', phone: '+33123456789', lineAdresse1: '6 Bd Haussmann' },
  GB: { city: 'London', postal: 'EC1A1BB', phone: '+442012345678', lineAdresse1: '12-13 Wells Mews' },
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
  userId = '';
  isSubmitting = false;
  isLoading = true;
  loadError: string | null = null;
  balanceAccountsError: string | null = null;
  businessLinesError: string | null = null;
  lastUpdated: number | null = null;
  lastCreatedStore: Store | null = null;
  readonly busyPmIds = new Set<string>();
  userCountryCode = '';
  userCountryLabel = '';

  commonPMs = COMMON_PAYMENT_METHODS;
  countryPMs: PaymentMethodDef[] = [];

  readonly stores = signal<Store[]>([]);
  readonly balanceAccounts = signal<BalanceAccount[]>([]);
  readonly businessLines = signal<BusinessLine[]>([]);

  // Add PM dialog state
  addPmStoreId: string | null = null;
  addPmLoading = false;
  addPmForm!: FormGroup;

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
    reference: ['', [Validators.required, Validators.pattern(/[a-zA-Z0-9]/)]],
    phoneNumber: ['', Validators.required],
    balanceAccountId: ['', Validators.required]
  });

  activityForm = this.fb.group({
    businessLineIds: this.fb.control<string[]>([], Validators.required)
  });

  paymentsForm!: FormGroup;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadStores();
        this.loadBalanceAccounts();
        this.loadBusinessLines();
        this.loadUserCountry();
      }
    });
  }

  loadUserCountry() {
    this.accountService.getUserById(this.userId).subscribe({
      next: user => {
        this.userCountryCode = user.countryCode;
        this.userCountryLabel = COUNTRY_LABELS[user.countryCode] || user.countryCode;
        this.countryPMs = COUNTRY_PAYMENT_METHODS[user.countryCode] || [];
        this.generalForm.patchValue({ country: user.countryCode });
        this.applySuggestions(user.countryCode);
        this.buildPaymentsForm();
        this.buildAddPmForm();
      },
      error: err => this.showError(httpErrorMessage(err, 'Could not load your account country. Refresh the page to try again.'))
    });
  }

  private buildPaymentsForm() {
    const allPMs = this.getAllPaymentMethods();
    const controls: Record<string, any> = {};
    for (const p of allPMs) {
      controls[p.key] = [false];
    }
    this.paymentsForm = this.fb.group(controls, { validators: [this.atLeastOneSelected()] });
  }

  private buildAddPmForm() {
    const allPMs = this.getAllPaymentMethods();
    const controls: Record<string, any> = {};
    for (const p of allPMs) {
      controls[p.key] = [false];
    }
    this.addPmForm = this.fb.group(controls);
  }

  getAllPaymentMethods(): PaymentMethodDef[] {
    return [...this.commonPMs, ...this.countryPMs];
  }

  getAvailablePMsForStore(store: Store): PaymentMethodDef[] {
    const existingTypes = new Set(store.paymentMethods.map(pm => pm.type));
    return this.getAllPaymentMethods().filter(pm => !existingTypes.has(pm.key));
  }

  loadStores() {
    this.isLoading = true;
    this.loadError = null;
    this.storeService.getStores(this.userId).subscribe({
      next: res => {
        this.stores.set(res);
        this.lastUpdated = Date.now();
        this.isLoading = false;
      },
      error: err => {
        this.loadError = httpErrorMessage(err, 'Could not load your stores.');
        this.isLoading = false;
      }
    });
  }

  refresh() {
    this.loadStores();
    this.loadBalanceAccounts();
    this.loadBusinessLines();
  }

  getLastUpdatedLabel(): string {
    if (!this.lastUpdated) return '';
    const seconds = Math.floor((Date.now() - this.lastUpdated) / 1000);
    if (seconds < 60) return 'Updated just now';
    const minutes = Math.floor(seconds / 60);
    return `Updated ${minutes} min ago`;
  }

  loadBalanceAccounts() {
    this.balanceAccountsError = null;
    this.accountService.getBalanceAccounts(this.userId).subscribe({
      next: res => this.balanceAccounts.set(res),
      error: err => this.balanceAccountsError = httpErrorMessage(err, 'Could not load balance accounts.')
    });
  }

  loadBusinessLines() {
    this.businessLinesError = null;
    this.activityService.getBusinessLines(this.userId).subscribe({
      next: res => this.businessLines.set(res),
      error: err => this.businessLinesError = httpErrorMessage(err, 'Could not load business lines.')
    });
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

  private resetGeneralForm() {
    const s = COUNTRY_SUGGESTIONS[this.userCountryCode];
    this.generalForm.reset({
      country: this.userCountryCode,
      city: s?.city ?? '',
      postalCode: s?.postal ?? '',
      phoneNumber: s?.phone ?? '',
      lineAdresse1: s?.lineAdresse1 ?? '',
      reference: '',
      balanceAccountId: ''
    });
  }

  generalHint(): string {
    const f = this.generalForm.controls;
    if (f.reference.hasError('required')) return 'Enter a store reference to continue.';
    if (f.reference.hasError('pattern')) return 'The store reference must contain at least one letter or digit.';
    if (f.city.invalid || f.postalCode.invalid || f.lineAdresse1.invalid || f.phoneNumber.invalid) {
      return 'Complete the address and phone number to continue.';
    }
    if (f.balanceAccountId.invalid) {
      return this.balanceAccounts().length ? 'Select a balance account to continue.' : 'No balance account is available for this account holder.';
    }
    return '';
  }

  activityHint(): string {
    if (this.activityForm.valid) return '';
    return this.businessLines().length
      ? 'Select at least one business activity to continue.'
      : 'Create a business line first, then come back to add a store.';
  }

  isInvalid(name: 'reference' | 'city' | 'postalCode' | 'lineAdresse1' | 'phoneNumber' | 'balanceAccountId'): boolean {
    const c = this.generalForm.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  addPmHasSelection(): boolean {
    if (!this.addPmForm) return false;
    return this.getAllPaymentMethods().some(p => {
      const c = this.addPmForm.get(p.key);
      return !!c && c.enabled && !!c.value;
    });
  }

  private showError(message: string) {
    this.snack.open(message, 'Close', { duration: 5000, panelClass: 'fintech-snack-error' });
  }

  sanitizeReference(ref: string): string {
    const clean = ref.replace(/[^a-zA-Z0-9]/g, '');
    const suffix = Math.random().toString(36).substring(2, 9).toUpperCase();
    return `${clean}_${suffix}`;
  }

  atLeastOneSelected() {
    return (form: any) => {
      const allPMs = this.getAllPaymentMethods();
      const valid = allPMs.some(p => form.get(p.key)?.value);
      return valid ? null : { required: true };
    };
  }

  getIndustryLabel(code: string): string {
    const ind = INDUSTRY_CODES.find(i => i.code === code);
    return ind ? ind.label : code;
  }

  getStatusView(status: VerificationStatus | string | null | undefined): VerificationStatusView {
    switch (status) {
      case 'valid': return { label: 'Verified', icon: 'check_circle', cls: 'valid' };
      case 'invalid': return { label: 'Action required', icon: 'error', cls: 'invalid' };
      case 'pending': return { label: 'Pending verification', icon: 'schedule', cls: 'pending' };
      case 'rejected':
      case 'reject': return { label: 'Rejected', icon: 'block', cls: 'rejected' };
      default: return { label: 'Status unknown', icon: 'help_outline', cls: 'unknown' };
    }
  }

  getPmLabel(key: string): string {
    const all = this.getAllPaymentMethods();
    return all.find(p => p.key === key)?.label || key;
  }

  // --- Add PM to existing store ---

  openAddPm(store: Store) {
    if (!this.addPmForm) return;
    this.addPmStoreId = store.storeId;
    this.buildAddPmForm();
    // Disable PMs already on this store
    const existingTypes = new Set(store.paymentMethods.map(pm => pm.type));
    for (const pm of this.getAllPaymentMethods()) {
      if (existingTypes.has(pm.key)) {
        this.addPmForm.get(pm.key)?.disable();
      }
    }
  }

  closeAddPm() {
    this.addPmStoreId = null;
  }

  submitAddPm() {
    if (!this.addPmStoreId) return;
    const selected = this.getAllPaymentMethods()
      .filter(p => this.addPmForm.get(p.key)?.value)
      .map(p => p.key);
    if (selected.length === 0) return;
    this.addPmLoading = true;
    this.storeService.addPaymentMethods(this.userId, this.addPmStoreId, selected).subscribe({
      next: updatedPMs => {
        const typedPMs = updatedPMs.map(pm => ({
          type: pm.type,
          verificationStatus: pm.verificationStatus as VerificationStatus,
          paymentMethodId: pm.paymentMethodId,
          enabled: pm.enabled
        }));
        const storesList = this.stores();
        const updated = storesList.map(s => {
          if (s.storeId === this.addPmStoreId) {
            return { ...s, paymentMethods: typedPMs };
          }
          return s;
        });
        this.stores.set(updated);
        const labels = selected.map(k => this.getPmLabel(k)).join(', ');
        this.snack.open(`Requested ${labels}. Verification can take a few minutes.`, 'Close', { duration: 4000 });
        this.addPmLoading = false;
        this.addPmStoreId = null;
      },
      error: err => {
        this.showError(httpErrorMessage(err, 'Could not add the payment methods.'));
        this.addPmLoading = false;
      }
    });
  }

  // --- Toggle PM enabled/disabled ---

  togglePaymentMethod(storeId: string, pm: { type: string; paymentMethodId: string; enabled: boolean }, event: MatSlideToggleChange) {
    if (this.busyPmIds.has(pm.paymentMethodId)) return;
    const newEnabled = event.checked;
    this.busyPmIds.add(pm.paymentMethodId);
    this.storeService.togglePaymentMethod(pm.paymentMethodId, newEnabled).subscribe({
      next: updated => {
        const storesList = this.stores();
        const updatedStores = storesList.map(s => {
          if (s.storeId === storeId) {
            return {
              ...s,
              paymentMethods: s.paymentMethods.map(p =>
                p.paymentMethodId === pm.paymentMethodId
                  ? { ...p, enabled: updated.enabled }
                  : p
              )
            };
          }
          return s;
        });
        this.stores.set(updatedStores);
        this.busyPmIds.delete(pm.paymentMethodId);
        this.snack.open(
          `${this.getPmLabel(pm.type)} ${updated.enabled ? 'enabled' : 'disabled'}`,
          'Close', { duration: 3000 }
        );
      },
      error: err => {
        this.busyPmIds.delete(pm.paymentMethodId);
        // The toggle already flipped visually; put it back to the server state.
        event.source.checked = pm.enabled;
        this.showError(httpErrorMessage(err, `Could not ${newEnabled ? 'enable' : 'disable'} ${this.getPmLabel(pm.type)}.`));
      }
    });
  }

  // --- Create store ---

  submitCreate(stepper: MatStepper) {
    if (this.isSubmitting || this.generalForm.invalid || this.activityForm.invalid || !this.paymentsForm || this.paymentsForm.invalid) return;

    this.isSubmitting = true;
    const general = this.generalForm.value;
    const activity = this.activityForm.value;
    const payments = this.paymentsForm.value;

    const allPMs = this.getAllPaymentMethods();
    const selectedPayments = allPMs.filter(p => payments[p.key]).map(p => p.key);

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
        this.lastCreatedStore = res;
        this.lastUpdated = Date.now();
        // stepper.reset() resets every step control, so defaults must be applied after it.
        stepper.reset();
        this.resetGeneralForm();
        this.activityForm.reset({ businessLineIds: [] });
        this.buildPaymentsForm();
        this.isSubmitting = false;
      },
      error: err => {
        this.showError(httpErrorMessage(err, 'Could not create the store.'));
        this.isSubmitting = false;
      }
    });
  }
}
