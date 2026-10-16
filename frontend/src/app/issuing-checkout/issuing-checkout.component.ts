import { Component, NgZone, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MaterialModule } from '../material.module';
import { AdvancedPaymentOptions, SendPaymentPayload, SendPaymentResponse, Store, StoredPaymentMethod, TokenPaymentPayload } from '../models';
import { CaptureService } from '../services';
import { IssuingPaymentService, IssuingUserInfo } from '../services/issuing-payment.service';
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
  sessionResultOf,
} from '../checkout/payment-outcome';
import { PaymentOutcomePanelComponent } from '../checkout/payment-outcome-panel.component';
import { AdvancedOptionsComponent } from '../checkout/advanced-options/advanced-options.component';
import {
  commissionWithinAmount,
  createAdvancedOptionsForm,
  defaultSplitDescription,
  toAdvancedOptions,
  withCaptureNote,
} from '../checkout/advanced-options/advanced-options';

const log = (...args: unknown[]) => { if (!environment.production) console.log(...args); };

type CheckoutTab = 'payment' | 'tokenize' | 'token-payment';

@Component({
  selector: 'app-issuing-checkout',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule,
    PaymentOutcomePanelComponent,
    AdvancedOptionsComponent
  ],
  templateUrl: './issuing-checkout.component.html',
  styleUrl: './issuing-checkout.component.css'
})
export class IssuingCheckoutComponent implements OnInit, OnDestroy {
  userId = '';
  issuingUserId = '';
  readonly currencies = ['EUR', 'USD', 'GBP'];

  readonly issuingUserInfo = signal<IssuingUserInfo | null>(null);
  readonly stores = signal<Store[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly activeTab = signal<CheckoutTab>('payment');

  readonly submitting = signal(false);
  readonly dropinActive = signal(false);
  readonly paymentOutcome = signal<PaymentOutcome | null>(null);
  /** Id on the Captures page of the current Drop-in payment (delayed or manual capture only). */
  readonly paymentTrackingId = signal<string | null>(null);

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
  readonly tokenPaymentTrackingId = signal<string | null>(null);

  checkoutForm: FormGroup;
  tokenizeForm: FormGroup;
  tokenPaymentForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private issuingPaymentService = inject(IssuingPaymentService);
  private captureService = inject(CaptureService);
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
      reference: ['', [Validators.required, Validators.pattern(/\S/)]],
      advanced: createAdvancedOptionsForm(this.fb)
    }, { validators: commissionWithinAmount('amount', ['advanced', 'split']) });

    this.tokenizeForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      reference: ['', [Validators.required, Validators.pattern(/\S/)]]
    });

    this.tokenPaymentForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
      reference: ['', [Validators.required, Validators.pattern(/\S/)]],
      advanced: createAdvancedOptionsForm(this.fb)
    }, { validators: commissionWithinAmount('amount', ['advanced', 'split']) });
  }

  get isEmbeddedPayment(): boolean {
    return this.issuingUserInfo()?.activityReason === 'embeddedPayment';
  }

  get paymentAdvanced(): FormGroup {
    return this.checkoutForm.get('advanced') as FormGroup;
  }

  get tokenPaymentAdvanced(): FormGroup {
    return this.tokenPaymentForm.get('advanced') as FormGroup;
  }

  /** Depends on the issuing test merchant, which receives the funds, not on the signed-in user. */
  get defaultSplit(): string {
    return defaultSplitDescription(this.issuingUserInfo()?.activityReason);
  }

  /** Amount of the form in minor units, or null while it isn't valid. */
  minorAmount(form: FormGroup): number | null {
    const control = form.get('amount');
    const value = Number(control?.value);
    return control?.valid && value > 0 ? toMinorUnits(value, form.get('currencyCode')?.value) : null;
  }

  openCaptures(): void {
    this.router.navigate(['/', this.userId, 'captures']);
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (!this.userId) return;
      this.loadIssuingUserInfo();
    });
  }

  ngOnDestroy() {
    this.unmountPaymentDropin();
    this.unmountTokenizeDropin();
  }

  loadIssuingUserInfo(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.issuingPaymentService.getUserInfo().subscribe({
      next: (info) => {
        this.issuingUserInfo.set(info);
        this.issuingUserId = info.userId;
        this.countryCode = info.countryCode;

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
        this.loadError.set(httpErrorMessage(err, "Couldn't load the issuing test merchant. Try again."));
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
        this.loadError.set(httpErrorMessage(err, "Couldn't load the stores. Try again."));
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
      return this.stores().length ? 'Select a store to continue.' : 'The issuing test merchant has no store yet.';
    }
    const amount = form.get('amount');
    if (amount?.invalid) {
      return amount.hasError('min') ? 'The amount must be at least 0.01.' : 'Enter an amount to continue.';
    }
    if (form.get('reference')?.invalid) {
      return 'Enter a reference to continue.';
    }
    if (form.get('advanced')?.invalid) {
      return 'Fix the advanced options to continue.';
    }
    if (form.hasError('commissionTooHigh')) {
      return "The commission can't be higher than the amount.";
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
      this.clientKey = (await firstValueFrom(this.issuingPaymentService.getClientKey())).key;
    }
    return this.clientKey;
  }

  private isShopperCancel(error: AdyenCheckoutError): boolean {
    return error?.name === 'CANCEL';
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
    const advancedOptions = toAdvancedOptions(this.paymentAdvanced, currency);

    const payload: SendPaymentPayload = {
      amount,
      currencyCode: currency,
      storeReference: this.storeReferenceOf(this.checkoutForm),
      userId: this.issuingUserId,
      reference,
      returnUserId: this.userId,
      advancedOptions
    };

    this.unmountPaymentDropin();
    this.paymentOutcome.set(null);
    this.paymentTrackingId.set(null);
    this.submitting.set(true);
    this.issuingPaymentService.sendPayment(payload).subscribe({
      next: (res) => {
        log('issuing sendPayment response:', res);
        this.paymentTrackingId.set(res.trackingId || null);
        this.mountPaymentDropin(res, { amount: res.amount ?? amount, currency: res.currency || currency, reference }, advancedOptions);
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
    this.paymentTrackingId.set(null);
    this.checkoutForm.reset({
      storeReference: this.checkoutForm.get('storeReference')?.value || '',
      currencyCode: this.checkoutForm.get('currencyCode')?.value || 'EUR',
      amount: null,
      reference: '',
      // Kept like the currency, so several payments can be tested with the same capture and split settings.
      advanced: this.paymentAdvanced.getRawValue()
    });
  }

  retryPayment(): void {
    this.paymentOutcome.set(null);
    this.onSubmit();
  }

  private async mountPaymentDropin(session: SendPaymentResponse, context: PaymentContext,
                                   options?: AdvancedPaymentOptions): Promise<void> {
    this.dropinActive.set(true);
    let mounted = false;
    try {
      const clientKey = await this.ensureClientKey();
      const globalConfiguration: CoreConfiguration = {
        session: { id: session.id, sessionData: session.sessionData },
        environment: 'test',
        countryCode: this.countryCode,
        amount: { value: session.amount, currency: session.currency },
        clientKey,
        onPaymentCompleted: (result) => this.zone.run(() =>
          this.showDropinResult(result.resultCode, result, session, context, options)),
        onPaymentFailed: (result) => this.zone.run(() =>
          this.showDropinResult(result?.resultCode ?? 'Error', result, session, context, options)),
        onError: (error) => this.zone.run(() => {
          if (this.isShopperCancel(error)) return;
          log('Issuing Drop-in error:', error);
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
          card: {
            hasHolderName: true,
            holderNameRequired: true,
            brands: ['visa', 'mc']
          }
        }
      };

      this.dropin = new Dropin(checkout, dropinConfiguration).mount('#issuing-dropin-container');
      mounted = true;
    } catch (e) {
      if (!environment.production) console.error('Failed to initialize issuing Drop-in', e);
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

  private showDropinResult(resultCode: string, result: unknown, session: SendPaymentResponse,
                           context: PaymentContext, options?: AdvancedPaymentOptions): void {
    const trackingId = session.trackingId || null;
    const outcome = withCaptureNote(describePaymentResult(resultCode, context, resultExtras(result)), options, !!trackingId);
    this.showPaymentOutcome(outcome);

    const sessionResult = sessionResultOf(result);
    if (!trackingId || !sessionResult) return;
    // The Drop-in result of the sessions flow has no PSP reference: the backend gets it from the session result.
    this.captureService.syncSessionResult(trackingId, this.userId, sessionResult).subscribe({
      next: (payment) => {
        if (payment.pspReference && !outcome.pspReference && this.paymentOutcome() === outcome) {
          this.paymentOutcome.set({ ...outcome, pspReference: payment.pspReference });
        }
      },
      error: (err) => log('Session result not synced, the Captures page relies on the webhook:', err)
    });
  }

  private unmountPaymentDropin(): void {
    this.dropin?.unmount();
    this.dropin = null;
    this.dropinActive.set(false);
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
      userId: this.issuingUserId,
      reference,
      returnUserId: this.userId
    };

    this.unmountTokenizeDropin();
    this.tokenizeOutcome.set(null);
    this.submittingTokenize.set(true);
    this.issuingPaymentService.createTokenizationSession(payload).subscribe({
      next: (res) => {
        log('issuing tokenize session response:', res);
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
          log('Issuing tokenization Drop-in error:', error);
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
          card: {
            hasHolderName: true,
            holderNameRequired: true,
            brands: ['visa', 'mc']
          }
        }
      };

      this.tokenizeDropin = new Dropin(checkout, dropinConfiguration).mount('#issuing-tokenize-dropin-container');
      mounted = true;
    } catch (e) {
      if (!environment.production) console.error('Failed to initialize issuing tokenization Drop-in', e);
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
    this.issuingPaymentService.getStoredPaymentMethods(this.storeReferenceOf(this.tokenPaymentForm)).subscribe({
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
      message: 'The card token is removed permanently. The card will need to be entered again for future payments.',
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
    this.issuingPaymentService.deleteStoredPaymentMethod(this.storeReferenceOf(this.tokenPaymentForm), method.recurringDetailReference).subscribe({
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
    const advancedOptions = toAdvancedOptions(this.tokenPaymentAdvanced, currency);

    const payload: TokenPaymentPayload = {
      amount,
      currencyCode: currency,
      storeReference: this.storeReferenceOf(this.tokenPaymentForm),
      userId: this.issuingUserId,
      reference,
      storedPaymentMethodId: method.recurringDetailReference,
      type: method.type,
      returnUserId: this.userId,
      advancedOptions
    };

    this.tokenPaymentTrackingId.set(null);
    this.submittingTokenPayment.set(true);
    this.issuingPaymentService.makeTokenPayment(payload).subscribe({
      next: (res) => {
        log('issuing token payment response:', res);
        this.tokenPaymentTrackingId.set(res.trackingId || null);
        this.tokenPaymentOutcome.set(withCaptureNote(describePaymentResult(res.resultCode, context, {
          refusalReason: res.refusalReason || undefined,
          pspReference: res.pspReference || undefined
        }), advancedOptions, !!res.trackingId));
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
    this.tokenPaymentTrackingId.set(null);
    this.tokenPaymentForm.reset({
      storeReference: this.tokenPaymentForm.get('storeReference')?.value || '',
      currencyCode: this.tokenPaymentForm.get('currencyCode')?.value || 'EUR',
      amount: null,
      reference: '',
      advanced: this.tokenPaymentAdvanced.getRawValue()
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
