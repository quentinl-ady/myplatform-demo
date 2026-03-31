import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';

import { MaterialModule } from '../material.module';
import { MyPlatformService, SendPaymentPayload, SendPaymentResponse, Store, User } from '../my-platform-service';
import { AdyenCheckout, CoreConfiguration, Dropin } from '@adyen/adyen-web/auto';
import '@adyen/adyen-web/styles/adyen.css';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule,
    MatSnackBarModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule
  ],
  template: `
    <div class="fintech-wrapper">

      <div class="header-section">
        <h2>Simulate Checkout</h2>
        <p>Test the Adyen Dropin integration.</p>
      </div>

      <div class="loading-state" *ngIf="loading()">
        <mat-spinner diameter="40"></mat-spinner>
        <span>Loading checkout data...</span>
      </div>

      <div class="checkout-layout" *ngIf="!loading()">

        <mat-card class="config-card">
          <h3 class="card-title">Payment Details</h3>

          <form [formGroup]="checkoutForm" (ngSubmit)="onSubmit()" class="fintech-form">

            <div class="form-group" *ngIf="user()?.activityReason === 'embeddedPayment'">
              <label>Select Store</label>
              <select class="fintech-input" formControlName="storeReference">
                <option value="" disabled selected>Choose a store...</option>
                <option *ngFor="let s of stores()" [value]="s.storeRef">
                  {{ s.storeRef }} ({{ s.city }}, {{ s.country }})
                </option>
              </select>
              <span class="helper-text error" *ngIf="stores().length === 0">No stores found for this user. Please create one first.</span>
            </div>

            <div class="form-row">
              <div class="form-group amount-group">
                <label>Amount (minor units)</label>
                <div class="input-with-icon">
                  <mat-icon class="input-icon">payments</mat-icon>
                  <input type="number" class="fintech-input pl-40" formControlName="amount" placeholder="e.g. 100 for 1.00" min="0" />
                </div>
                <span class="helper-text error" *ngIf="checkoutForm.get('amount')?.touched && checkoutForm.get('amount')?.hasError('required')">Amount is required</span>
              </div>

              <div class="form-group currency-group">
                <label>Currency</label>
                <select class="fintech-input" formControlName="currencyCode">
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Order Reference</label>
              <div class="input-with-icon">
                <mat-icon class="input-icon">receipt</mat-icon>
                <input type="text" class="fintech-input pl-40" formControlName="reference" placeholder="e.g. ORDER-1234" />
              </div>
              <span class="helper-text error" *ngIf="checkoutForm.get('reference')?.touched && checkoutForm.get('reference')?.hasError('required')">Reference is required</span>
            </div>

            <button mat-flat-button class="fintech-btn primary full-width mt-16" type="submit" [disabled]="checkoutForm.invalid || submitting()">
              <span *ngIf="!submitting()">Generate Payment UI</span>
              <mat-spinner *ngIf="submitting()" diameter="20" color="accent"></mat-spinner>
            </button>
          </form>
        </mat-card>

        <mat-card class="dropin-card" [class.active]="dropinActive">
          <div class="empty-dropin" *ngIf="!dropinActive">
            <mat-icon>shopping_cart_checkout</mat-icon>
            <p>Fill out the payment details and click generate to load the checkout.</p>
          </div>

          <div class="dropin-wrapper" [class.visible]="dropinActive">
            <h3 class="card-title dropin-title">Complete Payment</h3>
            <div id="dropin-container"></div>
          </div>
        </mat-card>

      </div>
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
      --fintech-danger: #d32f2f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper {
      max-width: 900px; /* Wider to accommodate side-by-side layout on desktop */
      margin: 40px auto;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
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

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 64px 0;
      color: var(--fintech-text-secondary);
    }

    /* Layout grid */
    .checkout-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
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
      margin: 0 0 24px 0;
      color: var(--fintech-text);
      border-bottom: 1px solid var(--fintech-border);
      padding-bottom: 16px;
    }

    /* Form Styles */
    .fintech-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-row {
      display: flex;
      gap: 16px;
    }
    .amount-group { flex: 2; }
    .currency-group { flex: 1; }

    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--fintech-text-secondary);
      margin-bottom: 8px;
    }

    .input-with-icon {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-icon {
      position: absolute;
      left: 12px;
      color: var(--fintech-text-secondary);
      font-size: 20px;
      width: 20px;
      height: 20px;
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
    .fintech-input.pl-40 {
      padding-left: 40px;
    }
    select.fintech-input {
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 16px;
      padding-right: 40px;
    }
    .fintech-input:focus {
      outline: none;
      border-color: var(--fintech-primary);
    }

    .helper-text {
      font-size: 11px;
      margin-top: 6px;
      display: block;
    }
    .helper-text.error {
      color: var(--fintech-danger);
    }

    .mt-16 { margin-top: 16px; }

    /* Buttons */
    .fintech-btn {
      border-radius: 24px !important;
      padding: 12px 24px !important;
      font-weight: 600 !important;
      letter-spacing: 0 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .fintech-btn.primary {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }
    .fintech-btn.full-width {
      width: 100%;
      font-size: 15px !important;
    }

    /* Adyen Dropin Area */
    .dropin-card {
      min-height: 400px;
      display: flex;
      flex-direction: column;
      transition: all 0.3s ease;
    }
    .dropin-card.active {
      border: 1px solid var(--fintech-primary);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08) !important;
    }

    .empty-dropin {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      height: 100%;
      flex-grow: 1;
      color: var(--fintech-text-secondary);
      padding: 40px;
    }
    .empty-dropin mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .empty-dropin p {
      font-size: 14px;
      margin: 0;
      line-height: 1.5;
    }

    .dropin-wrapper {
      display: none;
    }
    .dropin-wrapper.visible {
      display: block;
    }

    /* Adyen overrides to make it fit the theme */
    ::ng-deep .adyen-checkout__payment-method {
      border-radius: 12px !important;
      border: 1px solid var(--fintech-border) !important;
      margin-bottom: 8px !important;
    }
    ::ng-deep .adyen-checkout__button--pay {
      border-radius: 24px !important;
      background-color: var(--fintech-primary) !important;
      font-weight: 600 !important;
    }

    @media (max-width: 768px) {
      .checkout-layout {
        grid-template-columns: 1fr;
      }
      .dropin-card {
        min-height: auto;
      }
    }
  `]
})
export class CheckoutComponent implements OnInit {
  userId = '';
  readonly user = signal<User | null>(null);
  readonly stores = signal<Store[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);

  dropinActive = false; // Used for UI styling
  checkoutForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private authService = inject(MyPlatformService);
  private matSnackBar = inject(MatSnackBar);

  private dropin: Dropin | null = null;

  countryCode = 'FR';
  clientKey = '';

  constructor() {
    this.checkoutForm = this.fb.group({
      storeReference: [''],
      currencyCode: ['EUR', Validators.required],
      amount: [null, [Validators.required, Validators.min(0)]],
      reference: ['', Validators.required]
    });
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (!this.userId) return;
      this.loadUserAndMaybeStores();
    });

    this.authService.getClientKey().subscribe({
      next: value => this.clientKey = value.key
    });
  }

  private loadUserAndMaybeStores(): void {
    this.loading.set(true);
    this.authService.getUserById(Number(this.userId)).subscribe({
      next: (u) => {
        this.user.set(u);
        this.countryCode = u.countryCode;
        console.log("countryCode : " + this.countryCode);

        if (u.activityReason === 'embeddedPayment') {
          this.loadStores();
        } else {
          this.checkoutForm.patchValue({ storeReference: '' });
          this.loading.set(false);
        }
      },
      error: (err) => {
        console.error('Error fetching user', err);
        this.matSnackBar.open('Error while fetching user', 'Close', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  private loadStores(): void {
    this.loading.set(true);
    this.authService.getStores(Number(this.userId)).subscribe({
      next: (res) => {
        this.stores.set(res || []);
        if (this.stores().length) {
          this.checkoutForm.patchValue({ storeReference: this.stores()[0].storeRef });
        }
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading stores', err);
        this.matSnackBar.open('Error while loading stores', 'Close', { duration: 3000 });
        this.loading.set(false);
      }
    });
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
      userId: Number(this.userId),
      reference: this.checkoutForm.get('reference')?.value
    };

    this.submitting.set(true);
    this.authService.sendPayment(payload).subscribe({
      next: (res) => {
        console.log('sendPayment response:', res);
        this.matSnackBar.open('Request sent successfully', 'Close', { duration: 3000 });
        this.submitting.set(false);
        this.initAdyenCheckout(res);
      },
      error: (err) => {
        console.error('sendPayment error', err);
        this.matSnackBar.open('Error while sending request', 'Close', { duration: 3000 });
        this.submitting.set(false);
      }
    });
  }

  async initAdyenCheckout(sendPaymentResponse: SendPaymentResponse) {
    if (this.dropin) {
      this.dropin.unmount();
      this.dropin = null;
    }

    this.dropinActive = true; // Trigger UI changes
    const hostname = window.location.hostname;

    try {
      const jwtResponse = await firstValueFrom(
        this.authService.getGooglePayJwt(hostname)
      );

      const googlePayJwt = jwtResponse.googlePayJwtToken;
      console.log('googlePayJwt : ' + jwtResponse.googlePayJwtToken);

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
        onPaymentCompleted: (result, component) => console.info(result, component),
        onPaymentFailed: (result, component) => console.info(result, component),
        onError: (error, component) => console.error(error.name, error.message, error.stack, component)
      };

      const checkout = await AdyenCheckout(globalConfiguration);

      const googlePayConfiguration = {
        configuration: {
          merchantName: 'testQuentin',
          merchantId: 'BCR2DN5TRCO6VRS6',
          gatewayMerchantId: 'QuentinLecornuTEST',
          authJwt: googlePayJwt,
          merchantOrigin: "localhost"
        },
      };

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
      console.error("Failed to initialize Adyen Dropin", e);
      this.matSnackBar.open('Failed to initialize payment gateway', 'Close', { duration: 3000 });
      this.dropinActive = false;
    }
  }
}
