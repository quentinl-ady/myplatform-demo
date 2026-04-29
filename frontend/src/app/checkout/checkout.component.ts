import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MaterialModule } from '../material.module';
import { SendPaymentPayload, SendPaymentResponse, Store, User } from '../models';
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

  dropinActive = false; // Used for UI styling
  checkoutForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private paymentService = inject(PaymentService);
  private storeService = inject(StoreService);
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

    this.paymentService.getClientKey().subscribe({
      next: value => this.clientKey = value.key
    });
  }

  private loadUserAndMaybeStores(): void {
    this.loading.set(true);
    this.accountService.getUserById(Number(this.userId)).subscribe({
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
    this.storeService.getStores(Number(this.userId)).subscribe({
      next: (res) => {
        this.stores.set(res || []);
        if (this.stores().length) {
          this.checkoutForm.patchValue({ storeReference: this.stores()[0].storeRef });
        }
        this.loading.set(false);
      },
      error: (err) => {
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

  async initAdyenCheckout(sendPaymentResponse: SendPaymentResponse) {
    if (this.dropin) {
      this.dropin.unmount();
      this.dropin = null;
    }

    this.dropinActive = true; // Trigger UI changes
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
}
