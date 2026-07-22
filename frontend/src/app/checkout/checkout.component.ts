import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MaterialModule } from '../material.module';
import { SendPaymentPayload, SendPaymentResponse, Store, StoredPaymentMethod, TokenPaymentPayload, TokenPaymentResponse, User } from '../models';
import { AccountService, PaymentService, StoreService } from '../services';
import { AdyenCheckout, CoreConfiguration, Dropin } from '@adyen/adyen-web/auto';
import '@adyen/adyen-web/styles/adyen.css';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

const log = (...args: any[]) => { if (!environment.production) console.log(...args); };

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule
  ],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.css'
})
export class CheckoutComponent implements OnInit {
  userId = '';
  readonly user = signal<User | null>(null);
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
  private accountService = inject(AccountService);
  private paymentService = inject(PaymentService);
  private storeService = inject(StoreService);
  private matSnackBar = inject(MatSnackBar);

  private dropin: Dropin | null = null;
  private tokenizeDropin: Dropin | null = null;

  countryCode = 'FR';
  clientKey = '';

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
      this.loadUserAndMaybeStores();
    });

    this.paymentService.getClientKey().subscribe({
      next: value => this.clientKey = value.key
    });
  }

  private loadUserAndMaybeStores(): void {
    this.loading.set(true);
    this.accountService.getUserById(this.userId).subscribe({
      next: (u) => {
        this.user.set(u);
        this.countryCode = u.countryCode;
        log("countryCode : " + this.countryCode);

        if (u.activityReason === 'embeddedPayment') {
          this.loadStores();
        } else {
          this.checkoutForm.patchValue({ storeReference: '' });
          this.loading.set(false);
        }
      },
      error: (err) => {
        this.matSnackBar.open('Error while fetching user', 'Close', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  private loadStores(): void {
    this.loading.set(true);
    this.storeService.getStores(this.userId).subscribe({
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

    if (this.user()?.activityReason === 'embeddedPayment') {
      const sr = this.checkoutForm.get('storeReference')?.value;
      if (!sr) {
        this.matSnackBar.open('Please select a store', 'Close', { duration: 2500 });
        return;
      }
    }

    const payload: SendPaymentPayload = {
      amount: Number(this.checkoutForm.get('amount')?.value),
      currencyCode: this.checkoutForm.get('currencyCode')?.value,
      storeReference: (this.user()?.activityReason === 'embeddedPayment')
        ? this.checkoutForm.get('storeReference')?.value
        : '',
      userId: this.userId,
      reference: this.checkoutForm.get('reference')?.value
    };

    this.submitting.set(true);
    this.paymentService.sendPayment(payload).subscribe({
      next: (res) => {
        log('sendPayment response:', res);
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

    if (this.user()?.activityReason === 'embeddedPayment') {
      const sr = this.tokenizeForm.get('storeReference')?.value;
      if (!sr) {
        this.matSnackBar.open('Please select a store', 'Close', { duration: 2500 });
        return;
      }
    }

    const payload: SendPaymentPayload = {
      amount: 0,
      currencyCode: this.tokenizeForm.get('currencyCode')?.value,
      storeReference: (this.user()?.activityReason === 'embeddedPayment')
        ? this.tokenizeForm.get('storeReference')?.value
        : '',
      userId: this.userId,
      reference: this.tokenizeForm.get('reference')?.value
    };

    this.submitting.set(true);
    this.paymentService.createTokenizationSession(payload).subscribe({
      next: (res) => {
        log('tokenize session response:', res);
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
    const storeRef = (this.user()?.activityReason === 'embeddedPayment')
      ? (this.tokenPaymentForm.get('storeReference')?.value || '')
      : '';

    this.loadingStoredMethods.set(true);
    this.selectedStoredMethod = null;
    this.tokenPaymentResult.set(null);

    this.paymentService.getStoredPaymentMethods(this.userId, storeRef).subscribe({
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
    const storeRef = (this.user()?.activityReason === 'embeddedPayment')
      ? (this.tokenPaymentForm.get('storeReference')?.value || '')
      : '';

    this.paymentService.deleteStoredPaymentMethod(this.userId, storeRef, method.recurringDetailReference).subscribe({
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
      storeReference: (this.user()?.activityReason === 'embeddedPayment')
        ? this.tokenPaymentForm.get('storeReference')?.value
        : '',
      userId: this.userId,
      reference: this.tokenPaymentForm.get('reference')?.value,
      storedPaymentMethodId: this.selectedStoredMethod.recurringDetailReference,
      type: this.selectedStoredMethod.type
    };

    this.submittingTokenPayment.set(true);
    this.paymentService.makeTokenPayment(payload).subscribe({
      next: (res) => {
        log('token payment response:', res);
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
    const hostname = window.location.hostname;

    try {
      let googlePayConfiguration = {};
      try {
        const jwtResponse = await firstValueFrom(
          this.paymentService.getGooglePayJwt(hostname)
        );
        log('googlePayJwt : ' + jwtResponse.googlePayJwtToken);
        googlePayConfiguration = {
          configuration: {
            merchantName: 'testQuentin',
            merchantId: 'BCR2DN5TRCO6VRS6',
            gatewayMerchantId: 'QuentinLecornuTEST',
            authJwt: jwtResponse.googlePayJwtToken,
            merchantOrigin: new URL(environment.frontendUrl).hostname
          },
        };
      } catch (e) {
        console.warn('Google Pay JWT fetch failed, Drop-in will load without Google Pay config', e);
      }

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
        onPaymentCompleted: (result, component) => log('Payment completed', result),
        onPaymentFailed: (result, component) => log('Payment failed', result),
        onError: (error, component) => { if (!environment.production) console.error(error.name, error.message, error.stack, component); }
      };

      const checkout = await AdyenCheckout(globalConfiguration);

      const dropinConfiguration = {
        hasHolderName: true,
        holderNameRequired: true,
        billingAddressRequired: true,
        paymentMethodsConfiguration: {
          card: { hasHolderName: true, holderNameRequired: true },
          googlePayConfiguration
        }
      };

      this.dropin = new Dropin(checkout, dropinConfiguration).mount('#dropin-container');
    } catch (e) {
      if (!environment.production) console.error("Failed to initialize Adyen Dropin", e);
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
          log('Tokenization completed', result);
          this.matSnackBar.open('Card tokenized successfully!', 'Close', { duration: 5000 });
        },
        onPaymentFailed: (result, component) => log('Tokenization failed', result),
        onError: (error, component) => { if (!environment.production) console.error(error.name, error.message, error.stack, component); }
      };

      const checkout = await AdyenCheckout(globalConfiguration);

      const dropinConfiguration = {
        hasHolderName: true,
        holderNameRequired: true,
        billingAddressRequired: true,
        paymentMethodsConfiguration: {
          card: { hasHolderName: true, holderNameRequired: true }
        }
      };

      this.tokenizeDropin = new Dropin(checkout, dropinConfiguration).mount('#tokenize-dropin-container');
    } catch (e) {
      if (!environment.production) console.error("Failed to initialize Tokenize Dropin", e);
      this.matSnackBar.open('Failed to initialize tokenization gateway', 'Close', { duration: 3000 });
      this.tokenizeDropinActive = false;
    }
  }
}
