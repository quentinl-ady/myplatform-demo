import { Component, NgZone, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MaterialModule } from '../material.module';
import { SendPaymentPayload, SendPaymentResponse, Store, StoredPaymentMethod, TokenPaymentPayload, User } from '../models';
import { AccountService, PaymentService, StoreService } from '../services';
import { ConfirmService, httpErrorMessage, toMinorUnits } from '../shared';
import { AdyenCheckout, AdyenCheckoutError, CoreConfiguration, Dropin } from '@adyen/adyen-web/auto';
import '@adyen/adyen-web/styles/adyen.css';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  PaymentContext,
  PaymentOutcome,
  describePaymentResult,
  describeTokenizationResult,
  dropinLoadFailure,
  errorOutcome,
  resultExtras,
} from './payment-outcome';
import { PaymentOutcomePanelComponent } from './payment-outcome-panel.component';

const log = (...args: unknown[]) => { if (!environment.production) console.log(...args); };

type CheckoutTab = 'payment' | 'tokenize' | 'token-payment';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule,
    RouterLink,
    PaymentOutcomePanelComponent
  ],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.css'
})
export class CheckoutComponent implements OnInit, OnDestroy {
  userId = '';
  readonly currencies = ['EUR', 'USD', 'GBP'];

  readonly user = signal<User | null>(null);
  readonly stores = signal<Store[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly activeTab = signal<CheckoutTab>('payment');

  readonly submitting = signal(false);
  readonly dropinActive = signal(false);
  readonly paymentOutcome = signal<PaymentOutcome | null>(null);

  readonly submittingTokenize = signal(false);
  readonly tokenizeDropinActive = signal(false);
  readonly tokenizeOutcome = signal<PaymentOutcome | null>(null);

  readonly storedMethods = signal<StoredPaymentMethod[]>([]);
  readonly loadingStoredMethods = signal(false);
  readonly storedMethodsError = signal<string | null>(null);
  readonly selectedStoredMethod = signal<StoredPaymentMethod | null>(null);
  readonly deletingToken = signal<string | null>(null);
  readonly submittingTokenPayment = signal(false);
  readonly tokenPaymentOutcome = signal<PaymentOutcome | null>(null);

  checkoutForm: FormGroup;
  tokenizeForm: FormGroup;
  tokenPaymentForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private zone = inject(NgZone);
  private accountService = inject(AccountService);
  private paymentService = inject(PaymentService);
  private storeService = inject(StoreService);
  private matSnackBar = inject(MatSnackBar);
  private confirmService = inject(ConfirmService);

  private dropin: Dropin | null = null;
  private tokenizeDropin: Dropin | null = null;

  countryCode = 'FR';
  private clientKey = '';

  constructor() {
    this.checkoutForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
      reference: ['', [Validators.required, Validators.pattern(/\S/)]]
    });

    this.tokenizeForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      reference: ['', [Validators.required, Validators.pattern(/\S/)]]
    });

    this.tokenPaymentForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
      reference: ['', [Validators.required, Validators.pattern(/\S/)]]
    });
  }

  get isEmbeddedPayment(): boolean {
    return this.user()?.activityReason === 'embeddedPayment';
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (!this.userId) return;
      this.loadUserAndMaybeStores();
    });
  }

  ngOnDestroy() {
    this.unmountPaymentDropin();
    this.unmountTokenizeDropin();
  }

  loadUserAndMaybeStores(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.accountService.getUserById(this.userId).subscribe({
      next: (u) => {
        this.user.set(u);
        this.countryCode = u.countryCode;

        if (this.isEmbeddedPayment) {
          for (const form of [this.checkoutForm, this.tokenizeForm, this.tokenPaymentForm]) {
            form.get('storeReference')?.setValidators(Validators.required);
            form.get('storeReference')?.updateValueAndValidity({ emitEvent: false });
          }
          this.loadStores();
        } else {
          this.loading.set(false);
        }
      },
      error: (err) => {
        this.loadError.set(httpErrorMessage(err, "Couldn't load your account. Try again."));
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
        this.loadError.set(httpErrorMessage(err, "Couldn't load your stores. Try again."));
        this.loading.set(false);
      }
    });
  }

  switchTab(tab: CheckoutTab): void {
    this.activeTab.set(tab);
    if (tab === 'token-payment') {
      this.loadStoredPaymentMethods();
    }
  }

  /** Explains why a disabled submit button can't be used yet. */
  submitHint(form: FormGroup): string | null {
    if (this.isEmbeddedPayment && form.get('storeReference')?.invalid) {
      return this.stores().length ? 'Select a store to continue.' : 'Create a store before taking payments.';
    }
    const amount = form.get('amount');
    if (amount?.invalid) {
      return amount.hasError('min') ? 'The amount must be at least 0.01.' : 'Enter an amount to continue.';
    }
    if (form.get('reference')?.invalid) {
      return 'Enter a reference to continue.';
    }
    return null;
  }

  private storeReferenceOf(form: FormGroup): string {
    return this.isEmbeddedPayment ? (form.get('storeReference')?.value || '') : '';
  }

  private showError(message: string): void {
    this.matSnackBar.open(message, 'Close', { duration: 5000, panelClass: 'fintech-snack-error' });
  }

  private async ensureClientKey(): Promise<string> {
    if (!this.clientKey) {
      this.clientKey = (await firstValueFrom(this.paymentService.getClientKey())).key;
    }
    return this.clientKey;
  }

  // ---------- Payment ----------

  onSubmit(): void {
    if (this.checkoutForm.invalid) {
      this.checkoutForm.markAllAsTouched();
      return;
    }

    const currency: string = this.checkoutForm.get('currencyCode')?.value;
    const reference: string = String(this.checkoutForm.get('reference')?.value).trim();
    const amount = toMinorUnits(Number(this.checkoutForm.get('amount')?.value), currency);

    const payload: SendPaymentPayload = {
      amount,
      currencyCode: currency,
      storeReference: this.storeReferenceOf(this.checkoutForm),
      userId: this.userId,
      reference
    };

    this.unmountPaymentDropin();
    this.paymentOutcome.set(null);
    this.submitting.set(true);
    this.paymentService.sendPayment(payload).subscribe({
      next: (res) => {
        log('sendPayment response:', res);
        this.mountPaymentDropin(res, { amount: res.amount ?? amount, currency: res.currency || currency, reference });
      },
      error: (err) => {
        this.showError(httpErrorMessage(err, "Couldn't create the payment session. Try again."));
        this.submitting.set(false);
      }
    });
  }

  newPayment(): void {
    this.unmountPaymentDropin();
    this.paymentOutcome.set(null);
    this.checkoutForm.reset({
      storeReference: this.checkoutForm.get('storeReference')?.value || '',
      currencyCode: this.checkoutForm.get('currencyCode')?.value || 'EUR',
      amount: null,
      reference: ''
    });
  }

  retryPayment(): void {
    this.paymentOutcome.set(null);
    this.onSubmit();
  }

  private async mountPaymentDropin(session: SendPaymentResponse, context: PaymentContext): Promise<void> {
    this.dropinActive.set(true);
    let mounted = false;
    try {
      const clientKey = await this.ensureClientKey();
      const googlepay = await this.googlePayConfiguration();

      const globalConfiguration: CoreConfiguration = {
        session: { id: session.id, sessionData: session.sessionData },
        environment: 'test',
        countryCode: this.countryCode,
        amount: { value: session.amount, currency: session.currency },
        clientKey,
        onPaymentCompleted: (result) => this.zone.run(() =>
          this.showPaymentOutcome(describePaymentResult(result.resultCode, context, resultExtras(result)))),
        onPaymentFailed: (result) => this.zone.run(() =>
          this.showPaymentOutcome(describePaymentResult(result?.resultCode ?? 'Error', context, resultExtras(result)))),
        onError: (error) => this.zone.run(() => {
          if (this.isShopperCancel(error)) return;
          log('Drop-in error:', error);
          this.showPaymentOutcome(mounted
            ? errorOutcome('Payment failed', 'Something went wrong while processing the payment. Try again.', context)
            : dropinLoadFailure(error, 'payment form', context));
        })
      };

      const checkout = await AdyenCheckout(globalConfiguration);

      const dropinConfiguration = {
        hasHolderName: true,
        holderNameRequired: true,
        billingAddressRequired: true,
        paymentMethodsConfiguration: {
          card: { hasHolderName: true, holderNameRequired: true },
          ...(googlepay ? { googlepay } : {})
        }
      };

      this.dropin = new Dropin(checkout, dropinConfiguration).mount('#dropin-container');
      mounted = true;
    } catch (e) {
      if (!environment.production) console.error('Failed to initialize Adyen Drop-in', e);
      // A failed session setup has usually been reported through onError already.
      if (!this.paymentOutcome()) this.showPaymentOutcome(dropinLoadFailure(e, 'payment form', context));
      this.dropinActive.set(false);
    } finally {
      this.submitting.set(false);
    }
  }

  private showPaymentOutcome(outcome: PaymentOutcome): void {
    this.unmountPaymentDropin();
    this.paymentOutcome.set(outcome);
  }

  private unmountPaymentDropin(): void {
    this.dropin?.unmount();
    this.dropin = null;
    this.dropinActive.set(false);
  }

  /**
   * Google Pay through the platform JWT. Returns null (Google Pay not configured) when the backend
   * doesn't provide the merchant identifiers.
   */
  private async googlePayConfiguration() {
    // Must be the same hostname the JWT was issued for.
    const hostname = window.location.hostname;
    try {
      const res = await firstValueFrom(this.paymentService.getGooglePayJwt(hostname));
      if (!res?.googlePayJwtToken || !res.merchantId || !res.gatewayMerchantId) {
        log('Google Pay configuration incomplete, Google Pay is not configured', res);
        return null;
      }
      return {
        configuration: {
          merchantId: res.merchantId,
          gatewayMerchantId: res.gatewayMerchantId,
          ...(res.merchantName ? { merchantName: res.merchantName } : {}),
          authJwt: res.googlePayJwtToken,
          merchantOrigin: hostname
        }
      };
    } catch (e) {
      log('Google Pay JWT fetch failed, Drop-in loads without Google Pay', e);
      return null;
    }
  }

  private isShopperCancel(error: AdyenCheckoutError): boolean {
    return error?.name === 'CANCEL';
  }

  // ---------- Tokenization ----------

  onTokenizeSubmit(): void {
    if (this.tokenizeForm.invalid) {
      this.tokenizeForm.markAllAsTouched();
      return;
    }

    const currency: string = this.tokenizeForm.get('currencyCode')?.value;
    const reference: string = String(this.tokenizeForm.get('reference')?.value).trim();

    const payload: SendPaymentPayload = {
      amount: 0,
      currencyCode: currency,
      storeReference: this.storeReferenceOf(this.tokenizeForm),
      userId: this.userId,
      reference
    };

    this.unmountTokenizeDropin();
    this.tokenizeOutcome.set(null);
    this.submittingTokenize.set(true);
    this.paymentService.createTokenizationSession(payload).subscribe({
      next: (res) => {
        log('tokenize session response:', res);
        this.mountTokenizeDropin(res, { currency: res.currency || currency, reference });
      },
      error: (err) => {
        this.showError(httpErrorMessage(err, "Couldn't start the card tokenization. Try again."));
        this.submittingTokenize.set(false);
      }
    });
  }

  newTokenization(): void {
    this.unmountTokenizeDropin();
    this.tokenizeOutcome.set(null);
    this.tokenizeForm.reset({
      storeReference: this.tokenizeForm.get('storeReference')?.value || '',
      currencyCode: this.tokenizeForm.get('currencyCode')?.value || 'EUR',
      reference: ''
    });
  }

  retryTokenization(): void {
    this.tokenizeOutcome.set(null);
    this.onTokenizeSubmit();
  }

  goToSavedCards(): void {
    this.newTokenization();
    this.switchTab('token-payment');
  }

  private async mountTokenizeDropin(session: SendPaymentResponse, context: PaymentContext): Promise<void> {
    this.tokenizeDropinActive.set(true);
    let mounted = false;
    try {
      const clientKey = await this.ensureClientKey();
      const globalConfiguration: CoreConfiguration = {
        session: { id: session.id, sessionData: session.sessionData },
        environment: 'test',
        countryCode: this.countryCode,
        amount: { value: 0, currency: session.currency },
        clientKey,
        onPaymentCompleted: (result) => this.zone.run(() =>
          this.showTokenizeOutcome(describeTokenizationResult(result.resultCode, context, resultExtras(result)))),
        onPaymentFailed: (result) => this.zone.run(() =>
          this.showTokenizeOutcome(describeTokenizationResult(result?.resultCode ?? 'Error', context, resultExtras(result)))),
        onError: (error) => this.zone.run(() => {
          if (this.isShopperCancel(error)) return;
          log('Tokenization Drop-in error:', error);
          this.showTokenizeOutcome(mounted
            ? errorOutcome('Card not saved', 'Something went wrong while saving the card. Try again.', context)
            : dropinLoadFailure(error, 'card form', context));
        })
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
      mounted = true;
    } catch (e) {
      if (!environment.production) console.error('Failed to initialize tokenization Drop-in', e);
      if (!this.tokenizeOutcome()) this.showTokenizeOutcome(dropinLoadFailure(e, 'card form', context));
      this.tokenizeDropinActive.set(false);
    } finally {
      this.submittingTokenize.set(false);
    }
  }

  private showTokenizeOutcome(outcome: PaymentOutcome): void {
    this.unmountTokenizeDropin();
    this.tokenizeOutcome.set(outcome);
  }

  private unmountTokenizeDropin(): void {
    this.tokenizeDropin?.unmount();
    this.tokenizeDropin = null;
    this.tokenizeDropinActive.set(false);
  }

  // ---------- Pay with saved card ----------

  loadStoredPaymentMethods(): void {
    this.selectedStoredMethod.set(null);
    this.tokenPaymentOutcome.set(null);
    this.storedMethodsError.set(null);

    if (this.isEmbeddedPayment && !this.tokenPaymentForm.get('storeReference')?.value) {
      this.storedMethods.set([]);
      return;
    }

    this.loadingStoredMethods.set(true);
    this.paymentService.getStoredPaymentMethods(this.userId, this.storeReferenceOf(this.tokenPaymentForm)).subscribe({
      next: (methods) => {
        this.storedMethods.set(methods || []);
        this.loadingStoredMethods.set(false);
      },
      error: (err) => {
        this.storedMethods.set([]);
        this.storedMethodsError.set(httpErrorMessage(err, "Couldn't load saved cards. Try again."));
        this.loadingStoredMethods.set(false);
      }
    });
  }

  selectStoredMethod(method: StoredPaymentMethod): void {
    this.selectedStoredMethod.set(method);
    this.tokenPaymentOutcome.set(null);
  }

  isSelected(method: StoredPaymentMethod): boolean {
    return this.selectedStoredMethod()?.recurringDetailReference === method.recurringDetailReference;
  }

  cardLabel(method: StoredPaymentMethod): string {
    return `${(method.cardBrand || 'Card').toUpperCase()} •••• ${method.cardSummary}`;
  }

  async deleteStoredMethod(event: Event, method: StoredPaymentMethod): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete saved card?',
      message: 'The card token is removed permanently. The shopper will need to enter the card again for future payments.',
      details: [
        { label: 'Card', value: this.cardLabel(method) },
        { label: 'Expiry', value: `${method.expiryMonth}/${method.expiryYear}` },
        ...(method.holderName ? [{ label: 'Cardholder', value: method.holderName }] : [])
      ],
      confirmText: 'Delete card',
      danger: true
    });
    if (!confirmed) return;

    this.deletingToken.set(method.recurringDetailReference);
    this.paymentService.deleteStoredPaymentMethod(this.userId, this.storeReferenceOf(this.tokenPaymentForm), method.recurringDetailReference).subscribe({
      next: () => {
        this.deletingToken.set(null);
        this.matSnackBar.open('Saved card deleted', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
        this.loadStoredPaymentMethods();
      },
      error: (err) => {
        this.deletingToken.set(null);
        this.showError(httpErrorMessage(err, "Couldn't delete the saved card. Try again."));
      }
    });
  }

  onTokenPaymentSubmit(): void {
    const method = this.selectedStoredMethod();
    if (this.tokenPaymentForm.invalid || !method) {
      this.tokenPaymentForm.markAllAsTouched();
      return;
    }

    const currency: string = this.tokenPaymentForm.get('currencyCode')?.value;
    const reference: string = String(this.tokenPaymentForm.get('reference')?.value).trim();
    const amount = toMinorUnits(Number(this.tokenPaymentForm.get('amount')?.value), currency);
    const context: PaymentContext = { amount, currency, reference };

    const payload: TokenPaymentPayload = {
      amount,
      currencyCode: currency,
      storeReference: this.storeReferenceOf(this.tokenPaymentForm),
      userId: this.userId,
      reference,
      storedPaymentMethodId: method.recurringDetailReference,
      type: method.type
    };

    this.submittingTokenPayment.set(true);
    this.paymentService.makeTokenPayment(payload).subscribe({
      next: (res) => {
        log('token payment response:', res);
        this.tokenPaymentOutcome.set(describePaymentResult(res.resultCode, context, {
          refusalReason: res.refusalReason || undefined,
          pspReference: res.pspReference || undefined
        }));
        this.submittingTokenPayment.set(false);
      },
      error: (err) => {
        this.tokenPaymentOutcome.set(errorOutcome('Payment failed', httpErrorMessage(err, "Couldn't charge the saved card. Try again."), context));
        this.submittingTokenPayment.set(false);
      }
    });
  }

  newTokenPayment(): void {
    this.tokenPaymentOutcome.set(null);
    this.tokenPaymentForm.reset({
      storeReference: this.tokenPaymentForm.get('storeReference')?.value || '',
      currencyCode: this.tokenPaymentForm.get('currencyCode')?.value || 'EUR',
      amount: null,
      reference: ''
    });
  }

  retryTokenPayment(): void {
    this.tokenPaymentOutcome.set(null);
    this.onTokenPaymentSubmit();
  }

  isPositive(outcome: PaymentOutcome): boolean {
    return outcome.kind === 'success' || outcome.kind === 'pending';
  }
}
