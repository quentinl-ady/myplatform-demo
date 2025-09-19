import { Component, signal, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MaterialModule } from '../material.module';
import {MyPlatformService, SendPaymentPayload, SendPaymentResponse, Store, User} from '../my-platform-service';
import {AdyenCheckout, CoreConfiguration, Dropin} from '@adyen/adyen-web/auto';
import '@adyen/adyen-web/styles/adyen.css';

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
        MatFormFieldModule,
        MatSelectModule,
        MatInputModule
    ],
    template: `
<div class="checkout-container">
  <h1>Checkout</h1>

  <div class="loading-container" *ngIf="loading()">
    <mat-progress-spinner mode="indeterminate" diameter="36"></mat-progress-spinner>
    <span>Loading...</span>
  </div>

  <mat-card class="checkout-card" *ngIf="!loading()">
    <form [formGroup]="checkoutForm" (ngSubmit)="onSubmit()">
      <div *ngIf="user() && user()?.activityReason === 'embeddedPayment'">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Store</mat-label>
          <mat-select formControlName="storeReference" placeholder="Choose a store">
            <mat-option *ngFor="let s of stores()" [value]="s.storeRef">
              {{ s.storeRef }} — {{ s.city }} / {{ s.country }}
            </mat-option>
          </mat-select>
          <mat-hint *ngIf="stores().length === 0">No stores found for this user.</mat-hint>
        </mat-form-field>
      </div>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Currency</mat-label>
        <mat-select formControlName="currencyCode">
          <mat-option value="EUR">EUR</mat-option>
          <mat-option value="USD">USD</mat-option>
          <mat-option value="GBP">GBP</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Amount (minor units)</mat-label>
        <input matInput type="number" formControlName="amount" placeholder="Ex: 100 = 1.00" min="0" />
        <mat-hint>Enter the amount in minor units (integer, e.g. 100 → 1.00).</mat-hint>
        <mat-error *ngIf="checkoutForm.get('amount')?.hasError('required')">Amount is required</mat-error>
        <mat-error *ngIf="checkoutForm.get('amount')?.hasError('min')">Amount must be ≥ 0</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Reference</mat-label>
        <input matInput type="text" formControlName="reference" placeholder="Ex: ORDER-1234" />
        <mat-error *ngIf="checkoutForm.get('reference')?.hasError('required')">Reference is required</mat-error>
      </mat-form-field>

      <div class="actions">
        <button mat-flat-button color="primary" class="full-width" type="submit" [disabled]="checkoutForm.invalid || submitting()">
          <ng-container *ngIf="!submitting()">Generate Checkout</ng-container>
          <ng-container *ngIf="submitting()">
            <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
            &nbsp;Sending...
          </ng-container>
        </button>
      </div>
    </form>
  </mat-card>
</div>
<div id="dropin-container"></div>
  `,
    styles: [`
            .checkout-container { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; }
            .loading-container { display: flex; align-items: center; gap: 0.5rem; margin: 1rem 0; }
            .checkout-card { padding: 1rem; font-size: 1rem; }
            .full-width { width: 100%; }
            .actions { margin-top: 1rem; display: flex; }
            mat-form-field { margin-bottom: 0.75rem; }
            button mat-progress-spinner { vertical-align: middle; }
            `]
})
export class CheckoutComponent {
    userId = '';
    readonly user = signal<User | null>(null);
    readonly stores = signal<Store[]>([]);
    readonly loading = signal(false);
    readonly submitting = signal(false);

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
        })
    }

    private loadUserAndMaybeStores(): void {
        this.loading.set(true);
        this.authService.getUserById(Number(this.userId)).subscribe({
            next: (u) => {
                this.user.set(u);
                this.countryCode = u.countryCode;
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
            this.matSnackBar.open('Invalid form, please check the fields', 'Close', { duration: 2500 });
            return;
        }

        if (this.user() && this.user()?.activityReason === 'embeddedPayment') {
            const sr = this.checkoutForm.get('storeReference')?.value;
            if (!sr) {
                this.matSnackBar.open('Please select a store', 'Close', { duration: 2500 });
                return;
            }
        }

        const payload: SendPaymentPayload = {
            amount: Number(this.checkoutForm.get('amount')?.value),
            currencyCode: this.checkoutForm.get('currencyCode')?.value,
            storeReference: (this.user() && this.user()?.activityReason === 'embeddedPayment')
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

        const globalConfiguration: CoreConfiguration = {
            session : {
                id: sendPaymentResponse.id,
                sessionData : sendPaymentResponse.sessionData
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
        const dropinConfiguration = {
            hasHolderName: true,
            holderNameRequired: true,
            billingAddressRequired: true,
            paymentMethodsConfiguration: {
                card: { hasHolderName: true, holderNameRequired: true }
            }
        };
        this.dropin = new Dropin(checkout, dropinConfiguration).mount('#dropin-container');
    }
}
