import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MyPlatformService, PosPaymentRequest, PosPaymentResponse, Store, TerminalResponse } from '../my-platform-service';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
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
        <h2>Point of Sale (POS)</h2>
        <p>Manage physical payments directly from your terminal.</p>
      </div>

      <div class="loading-state" *ngIf="loadingStores()">
        <mat-spinner diameter="40"></mat-spinner>
        <span>Loading available stores...</span>
      </div>

      <div class="checkout-layout" *ngIf="!loadingStores()">
        <mat-card class="config-card">
          <h3 class="card-title">Payment Details</h3>

          <form [formGroup]="posForm" (ngSubmit)="onSubmit()" class="fintech-form">
            <div class="form-group">
              <label>Select Store</label>
              <select class="fintech-input" formControlName="storeId">
                <option value="" disabled selected>Choose a store...</option>
                <option *ngFor="let s of stores()" [value]="s.storeId">
                  {{ s.storeRef }} - {{ s.city }}, {{ s.country }} ({{ s.lineAdresse }})
                </option>
              </select>
              <span class="helper-text error" *ngIf="stores().length === 0">
                No stores found for this user.
              </span>
            </div>

            <div class="form-group">
              <label>Select Terminal</label>
              <div class="input-with-spinner">
                <select class="fintech-input" formControlName="terminalId">
                  <option value="" disabled selected>Choose a terminal...</option>
                  <option *ngFor="let t of terminals()" [value]="t.id">
                    {{ t.model }} - ID: {{ t.id }} (Status: {{ t.status }})
                  </option>
                </select>
                <mat-spinner *ngIf="loadingTerminals()" diameter="20" class="inline-spinner"></mat-spinner>
              </div>
              <span class="helper-text error" *ngIf="posForm.get('storeId')?.value && terminals().length === 0 && !loadingTerminals()">
                No terminals available for this store.
              </span>
            </div>

            <div class="form-row">
              <div class="form-group amount-group">
                <label>Amount</label>
                <div class="input-with-icon">
                  <mat-icon class="input-icon">payments</mat-icon>
                  <input type="number" class="fintech-input pl-40" formControlName="amount" placeholder="e.g. 15.50" min="0" step="0.01" />
                </div>
                <span class="helper-text error" *ngIf="posForm.get('amount')?.touched && posForm.get('amount')?.hasError('required')">Amount is required</span>
              </div>

              <div class="form-group currency-group">
                <label>Currency</label>
                <select class="fintech-input" formControlName="currency">
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Transaction Reference</label>
              <div class="input-with-icon">
                <mat-icon class="input-icon">receipt</mat-icon>
                <input type="text" class="fintech-input pl-40" formControlName="reference" placeholder="e.g. ORDER-POS-1234" />
              </div>
              <span class="helper-text error" *ngIf="posForm.get('reference')?.touched && posForm.get('reference')?.hasError('required')">Reference is required</span>
            </div>

            <button mat-flat-button class="fintech-btn primary full-width mt-16" type="submit" [disabled]="posForm.invalid || isPaying()">
              <span>Send to terminal</span>
            </button>
          </form>
        </mat-card>

        <mat-card class="dropin-card" [class.active]="isPaying() || paymentResult()">
          <div class="empty-dropin" *ngIf="!isPaying() && !paymentResult()">
            <mat-icon>point_of_sale</mat-icon>
            <p>Fill out the details and send the request to wake up the terminal.</p>
          </div>

          <div class="empty-dropin pending" *ngIf="isPaying()">
            <mat-spinner diameter="60" color="primary"></mat-spinner>
            <h3 class="mt-16">Transaction in progress...</h3>
            <p>Please present card on the terminal.</p>
          </div>

          <div class="result-wrapper" *ngIf="!isPaying() && paymentResult() as result">
            <div class="result-content" [ngClass]="result.status.toLowerCase()">
              <mat-icon class="status-icon" *ngIf="result.status === 'SUCCESS'">check_circle</mat-icon>
              <mat-icon class="status-icon" *ngIf="result.status === 'FAILURE'">cancel</mat-icon>
              <mat-icon class="status-icon" *ngIf="result.status === 'ERROR'">error</mat-icon>

              <h2>{{ result.status }}</h2>

              <div class="result-details">
                <p *ngIf="result.cardBrand"><strong>Brand:</strong> {{ result.cardBrand }}</p>
                <p *ngIf="result.maskedPan"><strong>Card:</strong> {{ result.maskedPan }}</p>
                <p *ngIf="result.pspReference"><strong>MyPlatform Ref:</strong> {{ result.pspReference }}</p>
                <p *ngIf="result.refusalReason" class="error-text"><strong>Reason:</strong> {{ result.refusalReason }}</p>
                <p *ngIf="result.errorCondition" class="error-text"><strong>Error:</strong> {{ result.errorCondition }}</p>
              </div>

              <button mat-stroked-button class="mt-16" (click)="resetPayment()">New transaction</button>
            </div>
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
      --fintech-success: #2e7d32;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper {
      max-width: 900px;
      margin: 40px auto;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .header-section { text-align: left; }
    .header-section h2 { font-size: 28px; font-weight: 700; color: var(--fintech-text); margin: 0 0 8px 0; letter-spacing: -0.5px; }
    .header-section p { color: var(--fintech-text-secondary); font-size: 15px; margin: 0; }

    .loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 64px 0; color: var(--fintech-text-secondary); }

    .checkout-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }

    mat-card { background: var(--fintech-surface); border-radius: var(--fintech-radius); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important; padding: 24px; }
    .card-title { font-size: 18px; font-weight: 600; margin: 0 0 24px 0; color: var(--fintech-text); border-bottom: 1px solid var(--fintech-border); padding-bottom: 16px; }

    .fintech-form { display: flex; flex-direction: column; gap: 16px; }
    .form-row { display: flex; gap: 16px; }
    .amount-group { flex: 2; }
    .currency-group { flex: 1; }

    .form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--fintech-text-secondary); margin-bottom: 8px; }

    .input-with-icon, .input-with-spinner { position: relative; display: flex; align-items: center; }
    .input-icon { position: absolute; left: 12px; color: var(--fintech-text-secondary); font-size: 20px; width: 20px; height: 20px; }
    .inline-spinner { position: absolute; right: 40px; }

    .fintech-input { width: 100%; padding: 12px 16px; border: 1px solid var(--fintech-border); border-radius: 10px; font-size: 15px; box-sizing: border-box; background: var(--fintech-surface); transition: border-color 0.2s; }
    .fintech-input.pl-40 { padding-left: 40px; }
    .fintech-input:disabled { background-color: var(--fintech-bg); color: var(--fintech-text-secondary); cursor: not-allowed; }

    select.fintech-input { appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px; padding-right: 40px; }
    .fintech-input:focus { outline: none; border-color: var(--fintech-primary); }

    .helper-text { font-size: 11px; margin-top: 6px; display: block; }
    .helper-text.error { color: var(--fintech-danger); }

    .mt-16 { margin-top: 16px; }

    .fintech-btn { border-radius: 24px !important; padding: 12px 24px !important; font-weight: 600 !important; letter-spacing: 0 !important; }
    .fintech-btn.primary { background-color: var(--fintech-primary) !important; color: white !important; }
    .fintech-btn.full-width { width: 100%; font-size: 15px !important; }

    .dropin-card { min-height: 400px; display: flex; flex-direction: column; transition: all 0.3s ease; }
    .dropin-card.active { border: 1px solid var(--fintech-primary); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08) !important; }

    .empty-dropin { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; height: 100%; flex-grow: 1; color: var(--fintech-text-secondary); padding: 40px; }
    .empty-dropin mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.5; }
    .empty-dropin p { font-size: 14px; margin: 0; line-height: 1.5; }

    .pending h3 { color: var(--fintech-text); margin-bottom: 8px; }

    .result-wrapper { display: flex; flex-direction: column; height: 100%; flex-grow: 1; justify-content: center; }
    .result-content { text-align: center; padding: 24px; border-radius: var(--fintech-radius); }
    .status-icon { font-size: 64px; width: 64px; height: 64px; margin-bottom: 16px; }

    .result-content h2 { margin-top: 0; font-size: 24px; }
    .result-details { text-align: left; background: var(--fintech-bg); padding: 16px; border-radius: 12px; margin-top: 24px; font-size: 14px; color: var(--fintech-text); }
    .result-details p { margin: 8px 0; }
    .error-text { color: var(--fintech-danger); }

    .success { color: var(--fintech-success); }
    .success .status-icon { color: var(--fintech-success); }
    .failure, .error { color: var(--fintech-danger); }
    .failure .status-icon, .error .status-icon { color: var(--fintech-danger); }

    @media (max-width: 768px) {
      .checkout-layout { grid-template-columns: 1fr; }
      .dropin-card { min-height: auto; }
    }
  `]
})
export class PosComponent implements OnInit {
  userId = '';
  readonly stores = signal<Store[]>([]);
  readonly terminals = signal<TerminalResponse[]>([]);

  readonly loadingStores = signal(false);
  readonly loadingTerminals = signal(false);
  readonly isPaying = signal(false);
  readonly paymentResult = signal<PosPaymentResponse | null>(null);

  posForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private authService = inject(MyPlatformService);
  private matSnackBar = inject(MatSnackBar);

  constructor() {
    this.posForm = this.fb.group({
      storeId: ['', Validators.required],
      terminalId: [{ value: '', disabled: true }, Validators.required],
      amount: [null, [Validators.required, Validators.min(0)]],
      currency: ['EUR', Validators.required],
      reference: ['', Validators.required]
    });
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadStores();
      }
    });

    this.posForm.get('storeId')?.valueChanges.subscribe(storeId => {
      if (storeId) {
        this.loadTerminals(storeId);
      } else {
        this.terminals.set([]);
        this.posForm.get('terminalId')?.disable();
      }
    });
  }

  private loadStores(): void {
    this.loadingStores.set(true);
    this.authService.getStores(Number(this.userId)).subscribe({
      next: (res) => {
        this.stores.set(res || []);
        this.loadingStores.set(false);
      },
      error: () => {
        this.matSnackBar.open('Error loading stores', 'Close', { duration: 3000 });
        this.loadingStores.set(false);
      }
    });
  }

  private loadTerminals(storeId: string): void {
    this.loadingTerminals.set(true);
    this.posForm.get('terminalId')?.disable();

    this.authService.listTerminals(storeId).subscribe({
      next: (res) => {
        this.terminals.set(res || []);
        if (this.terminals().length > 0) {
          this.posForm.get('terminalId')?.enable();
        }
        this.loadingTerminals.set(false);
      },
      error: () => {
        this.matSnackBar.open('Error loading terminals', 'Close', { duration: 3000 });
        this.terminals.set([]);
        this.loadingTerminals.set(false);
      }
    });
  }

  onSubmit(): void {
    if (this.posForm.invalid) {
      this.posForm.markAllAsTouched();
      this.matSnackBar.open('Invalid form, please check the fields', 'Close', { duration: 2500 });
      return;
    }

    const rawAmount = Number(this.posForm.get('amount')?.value);
    const minorUnitsAmount = Math.round(rawAmount * 100);

    const payload: PosPaymentRequest = {
      reference: this.posForm.get('reference')?.value,
      amount: minorUnitsAmount,
      currency: this.posForm.get('currency')?.value,
      terminalId: this.posForm.get('terminalId')?.value
    };

    this.isPaying.set(true);
    this.paymentResult.set(null);

    this.authService.makePosPayment(payload).subscribe({
      next: (res) => {
        this.paymentResult.set(res);
        this.isPaying.set(false);
      },
      error: () => {
        this.matSnackBar.open('Error communicating with the terminal', 'Close', { duration: 3000 });
        this.paymentResult.set({
          status: 'ERROR',
          pspReference: '',
          cardBrand: '',
          maskedPan: '',
          errorCondition: 'Network or API Error',
          refusalReason: '',
          reference: payload.reference
        });
        this.isPaying.set(false);
      }
    });
  }

  resetPayment(): void {
    this.paymentResult.set(null);
    this.posForm.patchValue({
      amount: null,
      reference: ''
    });
    this.posForm.get('amount')?.markAsUntouched();
    this.posForm.get('reference')?.markAsUntouched();
  }
}
