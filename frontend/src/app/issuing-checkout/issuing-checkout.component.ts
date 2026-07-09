import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MaterialModule } from '../material.module';
import { SendPaymentPayload, SendPaymentResponse, Store, StoredPaymentMethod, TokenPaymentPayload, TokenPaymentResponse } from '../models';
import { IssuingPaymentService, IssuingUserInfo } from '../services/issuing-payment.service';
import { AdyenCheckout, CoreConfiguration, Dropin } from '@adyen/adyen-web/auto';
import '@adyen/adyen-web/styles/adyen.css';
import { environment } from '../../environments/environment';

const log = (...args: any[]) => { if (!environment.production) console.log(...args); };

@Component({
  selector: 'app-issuing-checkout',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule
  ],
  templateUrl: './issuing-checkout.component.html',
  styleUrl: './issuing-checkout.component.css'
})
export class IssuingCheckoutComponent implements OnInit {
  userId = '';
  readonly issuingUserInfo = signal<IssuingUserInfo | null>(null);
  readonly stores = signal<Store[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);

  activeTab: 'payment' | 'tokenize' | 'token-payment' = 'payment';

  dropinActive = false;
  checkoutForm: FormGroup;

  tokenizeDropinActive = false;
  tokenizeForm: FormGroup;

  readonly storedMethods = signal<StoredPaymentMethod[]>([]);
  readonly loadingStoredMethods = signal(false);
  readonly submittingTokenPayment = signal(false);
  readonly tokenPaymentResult = signal<TokenPaymentResponse | null>(null);
  selectedStoredMethod: StoredPaymentMethod | null = null;
  tokenPaymentForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private issuingPaymentService = inject(IssuingPaymentService);
  private matSnackBar = inject(MatSnackBar);

  private dropin: Dropin | null = null;
  private tokenizeDropin: Dropin | null = null;

  countryCode = 'FR';
  clientKey = '';
  issuingUserId = '';

  constructor() {
    this.checkoutForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      amount: [null, [Validators.required, Validators.min(0)]],
      reference: ['', Validators.required]
    });

    this.tokenizeForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      reference: ['', Validators.required]
    });

    this.tokenPaymentForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      amount: [null, [Validators.required, Validators.min(1)]],
      reference: ['', Validators.required]
    });
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (!this.userId) return;
      this.loadIssuingUserInfo();
    });

    this.issuingPaymentService.getClientKey().subscribe({
      next: value => this.clientKey = value.key
    });
  }

  private loadIssuingUserInfo(): void {
    this.loading.set(true);
    this.issuingPaymentService.getUserInfo().subscribe({
      next: (info) => {
        this.issuingUserInfo.set(info);
        this.issuingUserId = info.userId;
        this.countryCode = info.countryCode;
        log("Issuing countryCode:", this.countryCode, "activityReason:", info.activityReason);

        if (info.activityReason === 'embeddedPayment') {
          this.loadStores();
        } else {
          this.checkoutForm.patchValue({ storeReference: '' });
          this.loading.set(false);
        }
      },
      error: (err) => {
        this.matSnackBar.open('Error while fetching issuing user info', 'Close', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  private loadStores(): void {
    this.loading.set(true);
    this.issuingPaymentService.getStores(this.issuingUserId).subscribe({
      next: (res) => {
        this.stores.set(res || []);
        if (this.stores().length) {
          const firstStore = this.stores()[0].storeRef;
          this.checkoutForm.patchValue({ storeReference: firstStore });
          this.tokenizeForm.patchValue({ storeReference: firstStore });
          this.tokenPaymentForm.patchValue({ storeReference: firstStore });
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.matSnackBar.open('Error while loading stores', 'Close', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  get isEmbeddedPayment(): boolean {
    return this.issuingUserInfo()?.activityReason === 'embeddedPayment';
  }

  switchTab(tab: 'payment' | 'tokenize' | 'token-payment'): void {
    this.activeTab = tab;
    if (tab === 'token-payment') {
      this.loadStoredPaymentMethods();
    }
  }

  onSubmit(): void {
    if (this.checkoutForm.invalid) {
      this.checkoutForm.markAllAsTouched();
      this.matSnackBar.open('Invalid form, please check the fields', 'Close', { duration: 2500 });
      return;
    }

    if (this.isEmbeddedPayment) {
      const sr = this.checkoutForm.get('storeReference')?.value;
      if (!sr) {
        this.matSnackBar.open('Please select a store', 'Close', { duration: 2500 });
        return;
      }
    }

    const payload: SendPaymentPayload = {
      amount: Number(this.checkoutForm.get('amount')?.value),
      currencyCode: this.checkoutForm.get('currencyCode')?.value,
      storeReference: this.isEmbeddedPayment
        ? this.checkoutForm.get('storeReference')?.value
        : '',
      userId: this.issuingUserId,
      reference: this.checkoutForm.get('reference')?.value
    };

    this.submitting.set(true);
    this.issuingPaymentService.sendPayment(payload).subscribe({
      next: (res) => {
        log('issuing sendPayment response:', res);
        this.matSnackBar.open('Request sent successfully', 'Close', { duration: 3000 });
        this.submitting.set(false);
        this.initAdyenCheckout(res);
      },
      error: (err) => {
        this.matSnackBar.open('Error while sending request', 'Close', { duration: 3000 });
        this.submitting.set(false);
      }
    });
  }

  onTokenizeSubmit(): void {
    if (this.tokenizeForm.invalid) {
      this.tokenizeForm.markAllAsTouched();
      this.matSnackBar.open('Invalid form, please check the fields', 'Close', { duration: 2500 });
      return;
    }

    if (this.isEmbeddedPayment) {
      const sr = this.tokenizeForm.get('storeReference')?.value;
      if (!sr) {
        this.matSnackBar.open('Please select a store', 'Close', { duration: 2500 });
        return;
      }
    }

    const payload: SendPaymentPayload = {
      amount: 0,
      currencyCode: this.tokenizeForm.get('currencyCode')?.value,
      storeReference: this.isEmbeddedPayment
        ? this.tokenizeForm.get('storeReference')?.value
        : '',
      userId: this.issuingUserId,
      reference: this.tokenizeForm.get('reference')?.value
    };

    this.submitting.set(true);
    this.issuingPaymentService.createTokenizationSession(payload).subscribe({
      next: (res) => {
        log('issuing tokenize session response:', res);
        this.matSnackBar.open('Tokenization session created', 'Close', { duration: 3000 });
        this.submitting.set(false);
        this.initTokenizeDropin(res);
      },
      error: (err) => {
        this.matSnackBar.open('Error creating tokenization session', 'Close', { duration: 3000 });
        this.submitting.set(false);
      }
    });
  }

  loadStoredPaymentMethods(): void {
    const storeRef = this.isEmbeddedPayment
      ? (this.tokenPaymentForm.get('storeReference')?.value || '')
      : '';

    this.loadingStoredMethods.set(true);
    this.selectedStoredMethod = null;
    this.tokenPaymentResult.set(null);

    this.issuingPaymentService.getStoredPaymentMethods(storeRef).subscribe({
      next: (methods) => {
        this.storedMethods.set(methods);
        this.loadingStoredMethods.set(false);
      },
      error: (err) => {
        this.matSnackBar.open('Error loading stored payment methods', 'Close', { duration: 3000 });
        this.loadingStoredMethods.set(false);
      }
    });
  }

  selectStoredMethod(method: StoredPaymentMethod): void {
    this.selectedStoredMethod = method;
    this.tokenPaymentResult.set(null);
  }

  deleteStoredMethod(event: Event, method: StoredPaymentMethod): void {
    event.stopPropagation();
    const storeRef = this.isEmbeddedPayment
      ? (this.tokenPaymentForm.get('storeReference')?.value || '')
      : '';

    this.issuingPaymentService.deleteStoredPaymentMethod(storeRef, method.recurringDetailReference).subscribe({
      next: () => {
        this.matSnackBar.open('Token deleted successfully', 'Close', { duration: 3000 });
        if (this.selectedStoredMethod?.recurringDetailReference === method.recurringDetailReference) {
          this.selectedStoredMethod = null;
        }
        this.loadStoredPaymentMethods();
      },
      error: () => {
        this.matSnackBar.open('Error deleting token', 'Close', { duration: 3000 });
      }
    });
  }

  onTokenPaymentSubmit(): void {
    if (this.tokenPaymentForm.invalid) {
      this.tokenPaymentForm.markAllAsTouched();
      this.matSnackBar.open('Invalid form, please check the fields', 'Close', { duration: 2500 });
      return;
    }

    if (!this.selectedStoredMethod) {
      this.matSnackBar.open('Please select a stored card', 'Close', { duration: 2500 });
      return;
    }

    const payload: TokenPaymentPayload = {
      amount: Number(this.tokenPaymentForm.get('amount')?.value),
      currencyCode: this.tokenPaymentForm.get('currencyCode')?.value,
      storeReference: this.isEmbeddedPayment
        ? this.tokenPaymentForm.get('storeReference')?.value
        : '',
      userId: this.issuingUserId,
      reference: this.tokenPaymentForm.get('reference')?.value,
      storedPaymentMethodId: this.selectedStoredMethod.recurringDetailReference
    };

    this.submittingTokenPayment.set(true);
    this.issuingPaymentService.makeTokenPayment(payload).subscribe({
      next: (res) => {
        log('issuing token payment response:', res);
        this.tokenPaymentResult.set(res);
        this.submittingTokenPayment.set(false);
        if (res.resultCode === 'Authorised') {
          this.matSnackBar.open('Payment Authorised! PSP: ' + res.pspReference, 'Close', { duration: 5000 });
        } else {
          this.matSnackBar.open('Payment ' + res.resultCode + (res.refusalReason ? ': ' + res.refusalReason : ''), 'Close', { duration: 5000 });
        }
      },
      error: (err) => {
        this.matSnackBar.open('Error processing token payment', 'Close', { duration: 3000 });
        this.submittingTokenPayment.set(false);
      }
    });
  }

  async initAdyenCheckout(sendPaymentResponse: SendPaymentResponse) {
    if (this.dropin) {
      this.dropin.unmount();
      this.dropin = null;
    }

    this.dropinActive = true;

    try {
      const globalConfiguration: CoreConfiguration = {
        session: {
          id: sendPaymentResponse.id,
          sessionData: sendPaymentResponse.sessionData
        },
        environment: "test",
        countryCode: this.countryCode,
        amount: {
          value: sendPaymentResponse.amount,
          currency: sendPaymentResponse.currency
        },
        clientKey: this.clientKey,
        onPaymentCompleted: (result, component) => log('Issuing payment completed', result),
        onPaymentFailed: (result, component) => log('Issuing payment failed', result),
        onError: (error, component) => { if (!environment.production) console.error(error.name, error.message, error.stack, component); }
      };

      const checkout = await AdyenCheckout(globalConfiguration);

      const dropinConfiguration = {
        hasHolderName: true,
        holderNameRequired: true,
        billingAddressRequired: true,
        paymentMethodsConfiguration: {
          card: {
            hasHolderName: true,
            holderNameRequired: true,
            brands: ['visa', 'mc']
          }
        }
      };

      this.dropin = new Dropin(checkout, dropinConfiguration).mount('#issuing-dropin-container');
    } catch (e) {
      if (!environment.production) console.error("Failed to initialize Issuing Adyen Dropin", e);
      this.matSnackBar.open('Failed to initialize payment gateway', 'Close', { duration: 3000 });
      this.dropinActive = false;
    }
  }

  async initTokenizeDropin(sendPaymentResponse: SendPaymentResponse) {
    if (this.tokenizeDropin) {
      this.tokenizeDropin.unmount();
      this.tokenizeDropin = null;
    }

    this.tokenizeDropinActive = true;

    try {
      const globalConfiguration: CoreConfiguration = {
        session: {
          id: sendPaymentResponse.id,
          sessionData: sendPaymentResponse.sessionData
        },
        environment: "test",
        countryCode: this.countryCode,
        amount: {
          value: 0,
          currency: sendPaymentResponse.currency
        },
        clientKey: this.clientKey,
        onPaymentCompleted: (result, component) => {
          log('Issuing tokenization completed', result);
          this.matSnackBar.open('Card tokenized successfully!', 'Close', { duration: 5000 });
        },
        onPaymentFailed: (result, component) => log('Issuing tokenization failed', result),
        onError: (error, component) => { if (!environment.production) console.error(error.name, error.message, error.stack, component); }
      };

      const checkout = await AdyenCheckout(globalConfiguration);

      const dropinConfiguration = {
        hasHolderName: true,
        holderNameRequired: true,
        billingAddressRequired: true,
        paymentMethodsConfiguration: {
          card: {
            hasHolderName: true,
            holderNameRequired: true,
            brands: ['visa', 'mc']
          }
        }
      };

      this.tokenizeDropin = new Dropin(checkout, dropinConfiguration).mount('#issuing-tokenize-dropin-container');
    } catch (e) {
      if (!environment.production) console.error("Failed to initialize Issuing Tokenize Dropin", e);
      this.matSnackBar.open('Failed to initialize tokenization gateway', 'Close', { duration: 3000 });
      this.tokenizeDropinActive = false;
    }
  }
}
