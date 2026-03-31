import { Component, OnInit, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  MyPlatformService,
  InitiateTransferRequest,
  InitiateTransferResponse,
  BankAccountInformationResponse
} from "../my-platform-service";

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatSnackBarModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="fintech-wrapper">

      <mat-card class="account-card" *ngIf="accountInfo">
        <div class="account-header">
          <p class="account-label">Available Balance</p>
          <h1 class="account-balance">
            {{ (accountInfo.amount / 100) | number:'1.2-2' }} <span class="currency">{{ accountInfo.currency }}</span>
          </h1>
          <p class="account-details">{{ accountInfo.description }} • {{ accountInfo.bankAccountNumber }}</p>
        </div>
        <div class="account-actions">
          <button mat-flat-button class="fintech-btn secondary" (click)="downloadRib()" [disabled]="isDownloadingRib">
            <mat-icon *ngIf="!isDownloadingRib">download</mat-icon>
            <mat-spinner *ngIf="isDownloadingRib" diameter="20"></mat-spinner>
            Download RIB
          </button>
        </div>
      </mat-card>

      <mat-card class="transfer-card success-state" *ngIf="isSuccess">
        <div class="success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <h2>Transfer Successful</h2>
        <p>Your money is on its way to the recipient.</p>
        <button mat-flat-button class="fintech-btn primary" (click)="resetForm()">Send another transfer</button>
      </mat-card>

      <mat-card class="transfer-card" *ngIf="!isSuccess">
        <h2>Send Money</h2>

        <form [formGroup]="form" (ngSubmit)="submit()">

          <div class="amount-wrapper">
            <span class="currency-symbol">€</span>
            <input type="number" class="amount-input" formControlName="amount" placeholder="0.00" step="0.01" />
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label>Account Holder Name</label>
              <input type="text" class="fintech-input" formControlName="accountHolderName" placeholder="e.g. John Doe" />
            </div>

            <div class="form-group">
              <label>Recipient IBAN</label>
              <input type="text" class="fintech-input" formControlName="iban" placeholder="FR76 1234..." />
            </div>

            <div class="form-group">
              <label>Transfer Type</label>
              <select class="fintech-input" formControlName="transferType">
                <option value="regular">Regular Transfer (1-2 days)</option>
                <option value="instant">Instant Transfer (Immediate)</option>
              </select>
            </div>

            <div class="form-group">
              <label>Reference</label>
              <input type="text" class="fintech-input" formControlName="reference" placeholder="e.g. Rent payment" />
            </div>
          </div>

          <button mat-flat-button class="fintech-btn primary full-width" type="submit" [disabled]="form.invalid || isProcessing">
            <span *ngIf="!isProcessing">Review Transfer</span>
            <mat-spinner *ngIf="isProcessing" diameter="24" color="accent"></mat-spinner>
          </button>
        </form>
      </mat-card>

      <div class="modal-overlay" *ngIf="showModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Confirm transfer</h3>
          </div>

          <div class="modal-body">
            <div class="summary-row">
              <span>Amount</span>
              <strong>{{ (transferResponse?.amount || 0) / 100 | number:'1.2-2' }} EUR</strong>
            </div>
            <div class="summary-row">
              <span>Recipient</span>
              <strong>{{ transferResponse?.counterparty }}</strong>
            </div>
            <div class="summary-row">
              <span>Type</span>
              <strong style="text-transform: capitalize;">{{ form.value.transferType }}</strong>
            </div>
          </div>

          <div class="actions">
            <button mat-stroked-button class="fintech-btn secondary" (click)="decline()" [disabled]="isProcessing">Cancel</button>
            <button mat-flat-button class="fintech-btn primary" (click)="approve()" [disabled]="isProcessing">
              <span *ngIf="!isProcessing">Approve</span>
              <mat-spinner *ngIf="isProcessing" diameter="20" color="accent"></mat-spinner>
            </button>
          </div>
        </div>
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper {
      max-width: 480px;
      margin: 40px auto;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    mat-card {
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
      padding: 24px;
    }

    /* Account Card */
    .account-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .account-label {
      color: var(--fintech-text-secondary);
      font-size: 14px;
      font-weight: 500;
      margin: 0 0 8px 0;
    }
    .account-balance {
      font-size: 40px;
      font-weight: 700;
      color: var(--fintech-text);
      margin: 0 0 8px 0;
      letter-spacing: -1px;
    }
    .account-balance .currency {
      font-size: 24px;
      color: var(--fintech-text-secondary);
    }
    .account-details {
      font-size: 13px;
      color: var(--fintech-text-secondary);
      margin: 0;
    }
    .account-actions {
      display: flex;
      justify-content: center;
    }

    /* Forms */
    .transfer-card h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 24px 0;
      color: var(--fintech-text);
    }

    .amount-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--fintech-bg);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .currency-symbol {
      font-size: 32px;
      font-weight: 600;
      color: var(--fintech-text);
      margin-right: 8px;
    }
    .amount-input {
      background: transparent;
      border: none;
      font-size: 40px;
      font-weight: 700;
      color: var(--fintech-text);
      width: 100%;
      outline: none;
    }
    .amount-input::placeholder {
      color: #ccc;
    }

    .form-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 32px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--fintech-text-secondary);
      margin-bottom: 6px;
    }
    .fintech-input {
      width: 100%;
      padding: 14px 16px;
      border: 1px solid var(--fintech-border);
      border-radius: 10px;
      font-size: 15px;
      box-sizing: border-box;
      background: var(--fintech-surface);
      transition: border-color 0.2s;
    }
    .fintech-input:focus {
      outline: none;
      border-color: var(--fintech-primary);
    }

    /* Buttons */
    .fintech-btn {
      border-radius: 24px !important;
      padding: 8px 24px !important;
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
    .fintech-btn.secondary {
      background-color: var(--fintech-bg) !important;
      color: var(--fintech-text) !important;
      border: none !important;
    }
    .fintech-btn.full-width {
      width: 100%;
      padding: 12px 24px !important;
      font-size: 16px !important;
    }

    /* Success State */
    .success-state {
      text-align: center;
      padding: 48px 24px;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background: #e8f5e9;
      color: #4caf50;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px auto;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
    }
    .success-state h2 {
      margin-bottom: 8px;
    }
    .success-state p {
      color: var(--fintech-text-secondary);
      margin-bottom: 32px;
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .modal-content {
      background: var(--fintech-surface);
      padding: 32px;
      border-radius: 20px;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    }
    .modal-header h3 {
      margin: 0 0 24px 0;
      font-size: 20px;
      font-weight: 600;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--fintech-border);
      font-size: 15px;
    }
    .summary-row:last-child {
      border-bottom: none;
      margin-bottom: 24px;
    }
    .summary-row span {
      color: var(--fintech-text-secondary);
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    .actions button {
      flex: 1;
    }
  `]
})
export class TransferComponent implements OnInit {

  private route = inject(ActivatedRoute);
  private authService = inject(MyPlatformService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  accountInfo?: BankAccountInformationResponse;

  showModal = false;
  isSuccess = false;
  isProcessing = false;
  isDownloadingRib = false;
  transferResponse?: InitiateTransferResponse;

  form = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    accountHolderName: ['', [Validators.required]],
    iban: ['', [Validators.required]],
    transferType: ['regular', [Validators.required]],
    reference: ['']
  });

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.fetchAccountInformation();
      }
    });
  }

  fetchAccountInformation() {
    this.authService.getBankAccountInformation(Number(this.userId)).subscribe({
      next: (info) => {
        this.accountInfo = info;
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to load account information', 'Close', { duration: 3000 });
      }
    });
  }

  downloadRib() {
    this.isDownloadingRib = true;
    this.authService.getRibPdf(Number(this.userId)).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RIB_${this.accountInfo?.bankAccountNumber || 'Account'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.isDownloadingRib = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isDownloadingRib = false;
        this.snack.open('Failed to download RIB', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  async submit() {
    if (this.form.invalid) return;
    this.isProcessing = true;

    try {
      const scaWebauthn = ScaWebauthn.create({
        relyingPartyName: 'myplatform',
      });

      const sdkOutput = await scaWebauthn.checkAvailability();

      const minorUnitAmount = Math.round(this.form.value.amount! * 100);

      const request = {
        sdkOutput: String(sdkOutput),
        amount: minorUnitAmount,
        counterpartyBankAccount: this.form.value.iban!,
        reference: this.form.value.reference || '',
        userId: Number(this.userId),
        accountHolderName: this.form.value.accountHolderName,
        transferType: this.form.value.transferType
      } as InitiateTransferRequest;

      this.authService.initiateTransfer(request).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            this.transferResponse = res;
            this.showModal = true;
            this.isProcessing = false;
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.ngZone.run(() => {
            this.isProcessing = false;
            this.snack.open('Transfer initiation failed', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });

    } catch (e) {
      this.isProcessing = false;
      this.snack.open('SCA initialization failed', 'Close', { duration: 3000 });
    }
  }

  decline() {
    this.showModal = false;
  }

  async approve() {
    if (!this.transferResponse) return;
    this.isProcessing = true;

    try {
      const scaWebauthn = ScaWebauthn.create({
        relyingPartyName: 'myplatform',
      });

      const sdkInput = this.transferResponse.authParam1;
      const sdkOutput = await scaWebauthn.authenticate(sdkInput);

      const minorUnitAmount = Math.round(this.form.value.amount! * 100);

      const request = {
        sdkOutput: String(sdkOutput),
        amount: minorUnitAmount,
        counterpartyBankAccount: this.form.value.iban!,
        reference: this.form.value.reference || '',
        userId: Number(this.userId),
        accountHolderName: this.form.value.accountHolderName,
        transferType: this.form.value.transferType
      } as InitiateTransferRequest;

      this.authService.finalizeTransfer(request).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.isSuccess = true;
            this.showModal = false;
            this.isProcessing = false;
            this.fetchAccountInformation();
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.ngZone.run(() => {
            this.isProcessing = false;
            this.snack.open('Transfer finalization failed', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });

    } catch (e) {
      this.isProcessing = false;
      this.snack.open('SCA authentication failed', 'Close', { duration: 3000 });
    }
  }

  resetForm() {
    this.isSuccess = false;
    this.form.reset({
      transferType: 'regular'
    });
  }
}
