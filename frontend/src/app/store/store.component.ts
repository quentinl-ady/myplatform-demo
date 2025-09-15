import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MaterialModule } from '../material.module';
import { MyPlatformService, Store, StorePayload, BusinessLine, BalanceAccount } from '../my-platform-service';
import {INDUSTRY_CODES} from "../industry-codes";

export const PAYMENT_METHODS = [
    { key: 'visa', label: 'Visa' },
    { key: 'mc', label: 'Mastercard' },
    { key: 'cartebancaire', label: 'Carte Bancaire' },
    { key: 'amex', label: 'American Express' }
];

const COUNTRY_SUGGESTIONS: Record<string, { city: string; postal: string; phone: string, lineAdresse1: string  }> = {
    FR: { city: 'Paris', postal: '75001', phone: '+33123456789', lineAdresse1: '6 Bd Haussmann' },
    UK: { city: 'London', postal: 'EC1A1BB', phone: '+442012345678', lineAdresse1: '12-13 Wells Mews'},
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
        MatFormFieldModule,
        MatSelectModule,
        MatCheckboxModule,
        MatInputModule,
        MatProgressSpinnerModule
    ],
    template: `
    <div class="store-container">
      <h1>Stores Management</h1>

      <div *ngIf="stores().length; else noStores">
        <mat-card *ngFor="let s of stores()" class="store-card">
          <div><strong>Reference:</strong> {{ s.storeRef }}</div>
          <div><strong>City:</strong> {{ s.city }}</div>
          <div><strong>Country:</strong> {{ s.country }}</div>
          <div><strong>Address:</strong> {{ s.lineAdresse }}</div>
          <div><strong>Phone:</strong> {{ s.phoneNumber }}</div>
          <div>
            <strong>Balance Account:</strong>
            {{ s.balanceAccountInfoCustomer.description }} ({{ s.balanceAccountInfoCustomer.currencyCode }})
          </div>
          <div>
            <strong>Payment Methods:</strong>
            <span *ngFor="let pm of s.paymentMethods" class="pm-badge">
              {{ pm.type }} - {{ getMessage(pm.verificationStatus) }}
            </span>
          </div>
        </mat-card>
      </div>
      <ng-template #noStores>
        <p>No stores yet.</p>
      </ng-template>

      <mat-card class="add-store-card">
        <h2>Add a Store</h2>
        <mat-vertical-stepper [linear]="true" #stepper>
          <mat-step [stepControl]="generalForm">
            <form [formGroup]="generalForm">
              <ng-template matStepLabel>General Information</ng-template>
              
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Store Reference</mat-label>
                <input matInput formControlName="reference" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Country</mat-label>
                <mat-select formControlName="country" (selectionChange)="applySuggestions($event.value)">
                  <mat-option value="FR">France</mat-option>
                  <mat-option value="UK">United Kingdom</mat-option>
                  <mat-option value="NL">Netherlands</mat-option>
                  <mat-option value="DE">Germany</mat-option>
                  <mat-option value="US">United States</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>City</mat-label>
                <input matInput formControlName="city" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Postal Code</mat-label>
                <input matInput formControlName="postalCode" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Address</mat-label>
                <input matInput formControlName="lineAdresse1" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Phone Number</mat-label>
                <input matInput formControlName="phoneNumber" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Balance Account</mat-label>
                <mat-select formControlName="balanceAccountId">
                  <mat-option *ngFor="let b of balanceAccounts()" [value]="b.balanceAccountId">
                    {{ b.description }} ({{ b.currencyCode }})
                  </mat-option>
                </mat-select>
              </mat-form-field>

              <div>
                <button mat-raised-button color="primary" matStepperNext [disabled]="generalForm.invalid">
                  Next
                </button>
              </div>
            </form>
          </mat-step>

          <mat-step [stepControl]="activityForm">
            <form [formGroup]="activityForm">
              <ng-template matStepLabel>Business Activity</ng-template>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Business Activity</mat-label>
                <mat-select formControlName="businessLineIds" multiple>
                  <mat-option *ngFor="let bl of businessLines()" [value]="bl.id">
                    {{ bl.industryCode }} - {{ getIndustryLabel(bl.industryCode) }} - {{ bl.salesChannels.join(', ') }}
                  </mat-option>
                </mat-select>
              </mat-form-field>

              <div>
                <button mat-raised-button matStepperPrevious>Back</button>
                <button mat-raised-button color="primary" matStepperNext [disabled]="activityForm.invalid">
                  Next
                </button>
              </div>
            </form>
          </mat-step>

          <mat-step [stepControl]="paymentsForm">
            <form [formGroup]="paymentsForm">
              <ng-template matStepLabel>Payment Methods</ng-template>

              <div class="checkbox-group">
                <mat-checkbox *ngFor="let p of PAYMENT_METHODS" formControlName="{{ p.key }}">
                  {{ p.label }} (10% commission)
                </mat-checkbox>
              </div>

              <div>
                <button mat-raised-button matStepperPrevious>Back</button>
                <button mat-raised-button color="primary" (click)="submitCreate(stepper)" [disabled]="paymentsForm.invalid">
                  Create Store
                </button>
              </div>
            </form>
          </mat-step>
        </mat-vertical-stepper>
      </mat-card>
    </div>
  `,
    styles: [`
    .store-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
    }
    .store-card, .add-store-card {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 10px;
    }
    .pm-badge {
      display: inline-block;
      background-color: #1976d2;
      color: white;
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
      font-size: 0.75rem;
      margin-right: 0.25rem;
    }
    .full-width { width: 100%; }
    .checkbox-group { display: flex; flex-direction: column; gap: 0.5rem; }
  `]
})
export class StoreComponent {
    userId = 0;

    readonly PAYMENT_METHODS = [
        { key: 'visa', label: 'Visa' },
        { key: 'mc', label: 'Mastercard' },
        { key: 'cartebancaire', label: 'Carte Bancaire' },
        { key: 'amex', label: 'American Express' }
    ];

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

    applySuggestions(country: string) {
        const s = COUNTRY_SUGGESTIONS[country];
        this.generalForm.patchValue({
            city: s.city,
            postalCode: s.postal,
            phoneNumber: s.phone,
            lineAdresse1: s.lineAdresse1
        });
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

    submitCreate(stepper: any) {
        if (this.generalForm.invalid || this.activityForm.invalid || this.paymentsForm.invalid) return;

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
            },
            error: () => this.snack.open('Error creating store', 'Close', { duration: 3000 })
        });
    }

    getMessage(status: string): string {
        switch (status) {
            case 'valid':
                return '✅ Validated';
            case 'invalid':
                return '❌ Invalid';
            case 'pending':
                return '⏳ Pending';
            case 'reject':
                return '🚫 Rejected';
            default:
                return status;
        }
    }
}
