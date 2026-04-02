import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef } from '@angular/core';
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

import { Subject, Subscription, combineLatest, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, startWith, catchError, filter } from 'rxjs/operators';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  MyPlatformService,
  InitiateTransferRequest,
  InitiateTransferResponse,
  BankAccountInformationResponse,
  VerifyCounterpartyNameRequest,
  CounterpartyVerificationResponse
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
              <input type="text" class="fintech-input" formControlName="accountHolderName" placeholder="e.g. John Doe / Acme Corp" />
            </div>

            <div class="form-group">
              <label>Recipient Country</label>
              <select class="fintech-input" formControlName="counterpartyCountry" (change)="onCountryChange($event)">
                <option value="" disabled selected>Select a country</option>
                <option value="FR">France</option>
                <option value="UK">United Kingdom</option>
                <option value="US">United States</option>
                <option value="DE">Germany</option>
                <option value="NL">Netherlands</option>
              </select>
            </div>

            <div class="loading-format" *ngIf="isLoadingFormat">
              <mat-spinner diameter="20"></mat-spinner>
              <span>Loading banking requirements...</span>
            </div>

            <ng-container *ngIf="bankAccountFormat && !isLoadingFormat">

              <div class="form-group" *ngIf="bankAccountFormat === 'iban'">
                <label>Recipient IBAN</label>
                <input type="text" class="fintech-input" formControlName="iban" placeholder="FR76 1234..." />
              </div>

              <ng-container *ngIf="bankAccountFormat === 'accountNumberRoutingNumber'">
                <div class="form-group">
                  <label>Account Number</label>
                  <input type="text" class="fintech-input" formControlName="accountNumber" placeholder="e.g. 123456789" />
                </div>
                <div class="form-group">
                  <label>Routing Number</label>
                  <input type="text" class="fintech-input" formControlName="routingNumber" placeholder="e.g. 122105278" />
                </div>
              </ng-container>

              <ng-container *ngIf="bankAccountFormat === 'accountNumberSortCode'">
                <div class="form-group">
                  <label>Account Number</label>
                  <input type="text" class="fintech-input" formControlName="accountNumber" placeholder="e.g. 12345678" />
                </div>
                <div class="form-group">
                  <label>Sort Code</label>
                  <input type="text" class="fintech-input" formControlName="sortCode" placeholder="e.g. 20-00-00" />
                </div>
              </ng-container>

              <div class="validation-status" *ngIf="isCheckingAccountFormat || isAccountFormatValid || accountFormatError">
                <mat-spinner *ngIf="isCheckingAccountFormat" diameter="16"></mat-spinner>
                <mat-icon *ngIf="isAccountFormatValid && !isCheckingAccountFormat" class="success-icon-small">check_circle</mat-icon>
                <mat-icon *ngIf="accountFormatError && !isCheckingAccountFormat" class="error-icon-small">error</mat-icon>
                <span [ngClass]="{'success-text': isAccountFormatValid, 'error-text': accountFormatError, 'pending-text': isCheckingAccountFormat}">
                  {{ isCheckingAccountFormat ? 'Verifying account format...' : (isAccountFormatValid ? 'Valid account format' : accountFormatError) }}
                </span>
              </div>

            </ng-container>

            <div class="form-group">
              <label>Transfer Type</label>
              <select class="fintech-input" formControlName="transferType">
                <option value="regular">Regular Transfer (1-2 days)</option>
                <option value="instant">Instant Transfer (Immediate)</option>
              </select>
            </div>

            <div class="fee-warning" *ngIf="form.get('transferType')?.value === 'instant'">
              <mat-icon class="fee-icon">info</mat-icon>
              <span>A 1% additional commission will be applied and deducted from your account at the end of the month.</span>
            </div>

            <div class="form-group">
              <label>Reference</label>
              <input type="text" class="fintech-input" formControlName="reference" placeholder="e.g. Rent payment" />
            </div>
          </div>

          <button mat-flat-button class="fintech-btn primary full-width" type="submit"
                  [disabled]="form.invalid || isProcessing || isLoadingFormat || !bankAccountFormat || !isAccountFormatValid || isCheckingAccountFormat">
            <span *ngIf="!isProcessing">Review Transfer</span>
            <mat-spinner *ngIf="isProcessing" diameter="24" color="accent"></mat-spinner>
          </button>
        </form>
      </mat-card>

      <div class="modal-overlay" *ngIf="showExactMatchModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="color: #4caf50;">Name Verified Successfully</h3>
          </div>
          <div class="modal-body" style="margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
              <mat-icon style="color: #4caf50;">check_circle</mat-icon>
              <span>The beneficiary name perfectly matches the account details.</span>
            </div>
            <p>Name confirmed: <strong>{{ form.value.accountHolderName }}</strong></p>
          </div>
          <div class="actions">
            <button mat-stroked-button class="fintech-btn secondary" (click)="modifyInfo()" [disabled]="isProcessing">Modify</button>
            <button mat-flat-button class="fintech-btn primary" (click)="proceedAfterExactMatch()" [disabled]="isProcessing">Continue</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" *ngIf="showPartialMatchModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="color: var(--fintech-warning);">Name Mismatch Warning</h3>
          </div>
          <div class="modal-body" style="margin-bottom: 24px;">
            <p>The account name is slightly different from what you entered.</p>
            <p>You entered: <br><strong>{{ form.value.accountHolderName }}</strong></p>
            <p>Bank verification found: <br><strong style="color: var(--fintech-primary);">{{ suggestedName }}</strong></p>
            <p style="font-size: 13px; color: var(--fintech-text-secondary); margin-top: 16px;">Would you like to use the name provided by the bank, modify your transfer, or cancel?</p>
          </div>
          <div class="actions" style="flex-direction: column; gap: 8px;">
            <button mat-flat-button class="fintech-btn primary" (click)="acceptSuggestedName()" [disabled]="isProcessing">Use Found Name & Continue</button>
            <div style="display: flex; gap: 8px; width: 100%;">
              <button mat-stroked-button class="fintech-btn secondary" (click)="modifyInfo()" [disabled]="isProcessing">Modify</button>
              <button mat-stroked-button class="fintech-btn secondary" (click)="cancelEntireTransfer()" [disabled]="isProcessing">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" *ngIf="showNoMatchModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="color: #f44336;">Warning: Invalid Name</h3>
          </div>
          <div class="modal-body" style="margin-bottom: 24px;">
            <p>The name on the destination account <strong>does not match</strong> the beneficiary name you provided.</p>
            <p style="font-size: 13px; color: var(--fintech-text-secondary); margin-top: 16px;">Sending money to an incorrect beneficiary can result in loss of funds. Do you still want to proceed at your own risk?</p>
          </div>
          <div class="actions" style="flex-direction: column; gap: 8px;">
             <button mat-flat-button style="background-color: #f44336; color: white;" class="fintech-btn" (click)="proceedWithRisk()" [disabled]="isProcessing">Continue at my own risk</button>
             <div style="display: flex; gap: 8px; width: 100%;">
              <button mat-stroked-button class="fintech-btn secondary" (click)="modifyInfo()" [disabled]="isProcessing">Modify</button>
              <button mat-stroked-button class="fintech-btn secondary" (click)="cancelEntireTransfer()" [disabled]="isProcessing">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" *ngIf="showModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Confirm transfer</h3>
          </div>

          <div class="modal-body">
            <div class="summary-row">
              <span>Amount</span>
              <strong>{{ (transferResponse?.amount || 0) / 100 | number:'1.2-2' }} {{ accountInfo?.currency }}</strong>
            </div>
            <div class="summary-row">
              <span>Recipient Name</span>
              <strong>{{ form.value.accountHolderName }}</strong>
            </div>
            <div class="summary-row">
              <span>Country</span>
              <strong>{{ transferResponse?.counterpartyCountry }}</strong>
            </div>
            <div class="summary-row" *ngIf="transferResponse?.iban">
              <span>IBAN</span>
              <strong>{{ transferResponse?.iban }}</strong>
            </div>
            <div class="summary-row" *ngIf="transferResponse?.accountNumber">
              <span>Account No.</span>
              <strong>{{ transferResponse?.accountNumber }}</strong>
            </div>
            <div class="summary-row" *ngIf="transferResponse?.sortCode">
              <span>Sort Code</span>
              <strong>{{ transferResponse?.sortCode }}</strong>
            </div>
            <div class="summary-row" *ngIf="transferResponse?.routingNumber">
              <span>Routing No.</span>
              <strong>{{ transferResponse?.routingNumber }}</strong>
            </div>
            <div class="summary-row">
              <span>Type</span>
              <strong style="text-transform: capitalize;">{{ form.value.transferType }}</strong>
            </div>
            <div class="summary-row" *ngIf="form.value.transferType === 'instant'">
              <span>Fee</span>
              <strong style="color: var(--fintech-warning);">1% (Billed end of month)</strong>
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
    /* Styles conservés */
    :host {
      --fintech-primary: #000000;
      --fintech-bg: #f5f6f8;
      --fintech-surface: #ffffff;
      --fintech-text: #1a1a1a;
      --fintech-text-secondary: #737373;
      --fintech-border: #e5e5e5;
      --fintech-radius: 16px;
      --fintech-warning: #f57c00;
      --fintech-warning-bg: #fff3e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper { max-width: 480px; margin: 40px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 24px; }
    mat-card { background: var(--fintech-surface); border-radius: var(--fintech-radius); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important; padding: 24px; }
    .account-header { text-align: center; margin-bottom: 24px; }
    .account-label { color: var(--fintech-text-secondary); font-size: 14px; font-weight: 500; margin: 0 0 8px 0; }
    .account-balance { font-size: 40px; font-weight: 700; color: var(--fintech-text); margin: 0 0 8px 0; letter-spacing: -1px; }
    .account-balance .currency { font-size: 24px; color: var(--fintech-text-secondary); }
    .account-details { font-size: 13px; color: var(--fintech-text-secondary); margin: 0; }
    .account-actions { display: flex; justify-content: center; }
    .transfer-card h2 { font-size: 20px; font-weight: 600; margin: 0 0 24px 0; color: var(--fintech-text); }
    .amount-wrapper { display: flex; align-items: center; justify-content: center; background: var(--fintech-bg); border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .currency-symbol { font-size: 32px; font-weight: 600; color: var(--fintech-text); margin-right: 8px; }
    .amount-input { background: transparent; border: none; font-size: 40px; font-weight: 700; color: var(--fintech-text); width: 100%; outline: none; }
    .amount-input::placeholder { color: #ccc; }
    .form-grid { display: flex; flex-direction: column; gap: 16px; margin-bottom: 32px; }
    .form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--fintech-text-secondary); margin-bottom: 6px; }
    .fintech-input { width: 100%; padding: 14px 16px; border: 1px solid var(--fintech-border); border-radius: 10px; font-size: 15px; box-sizing: border-box; background: var(--fintech-surface); transition: border-color 0.2s; }
    .fintech-input:focus { outline: none; border-color: var(--fintech-primary); }
    .fee-warning { display: flex; align-items: flex-start; gap: 12px; background-color: var(--fintech-warning-bg); border-left: 4px solid var(--fintech-warning); padding: 12px 16px; border-radius: 8px; font-size: 13px; line-height: 1.4; color: #3e2723; }
    .fee-icon { color: var(--fintech-warning); font-size: 20px; width: 20px; height: 20px; }
    .loading-format { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--fintech-text-secondary); padding: 8px 0; }
    .validation-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; padding: 4px 8px; margin-top: -4px; border-radius: 8px; }
    .success-icon-small { color: #4caf50; font-size: 18px; width: 18px; height: 18px; }
    .error-icon-small { color: #f44336; font-size: 18px; width: 18px; height: 18px; }
    .success-text { color: #4caf50; }
    .error-text { color: #f44336; }
    .pending-text { color: var(--fintech-text-secondary); }
    .fintech-btn { border-radius: 24px !important; padding: 8px 24px !important; font-weight: 600 !important; letter-spacing: 0 !important; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .fintech-btn.primary { background-color: var(--fintech-primary) !important; color: white !important; }
    .fintech-btn:disabled { background-color: var(--fintech-border) !important; color: var(--fintech-text-secondary) !important; cursor: not-allowed !important; opacity: 0.7; box-shadow: none !important; }
    .fintech-btn.secondary { background-color: var(--fintech-bg) !important; color: var(--fintech-text) !important; border: none !important; }
    .fintech-btn.full-width { width: 100%; padding: 12px 24px !important; font-size: 16px !important; }
    .success-state { text-align: center; padding: 48px 24px; }
    .success-icon { width: 64px; height: 64px; background: #e8f5e9; color: #4caf50; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px auto; }
    .success-icon svg { width: 32px; height: 32px; }
    .success-state h2 { margin-bottom: 8px; }
    .success-state p { color: var(--fintech-text-secondary); margin-bottom: 32px; }
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px); display: flex; justify-content: center; align-items: center; z-index: 1000; }
    .modal-content { background: var(--fintech-surface); padding: 32px; border-radius: 20px; width: 100%; max-width: 360px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
    .modal-header h3 { margin: 0 0 24px 0; font-size: 20px; font-weight: 600; }
    .summary-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--fintech-border); font-size: 15px; }
    .summary-row:last-child { border-bottom: none; margin-bottom: 24px; }
    .summary-row span { color: var(--fintech-text-secondary); }
    .actions { display: flex; gap: 12px; }
    .actions button { flex: 1; }
  `]
})
export class TransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private authService = inject(MyPlatformService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  accountInfo?: BankAccountInformationResponse;

  showExactMatchModal = false;
  showPartialMatchModal = false;
  showNoMatchModal = false;
  showModal = false;

  suggestedName = '';

  isSuccess = false;
  isProcessing = false;
  isDownloadingRib = false;
  isLoadingFormat = false;
  transferResponse?: InitiateTransferResponse;

  bankAccountFormat: 'iban' | 'accountNumberRoutingNumber' | 'accountNumberSortCode' | null = null;

  isCheckingAccountFormat = false;
  isAccountFormatValid = false;
  accountFormatError = '';
  private validationSub?: Subscription;

  form = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    accountHolderName: ['', [Validators.required]],
    transferType: ['regular', [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    reference: [''],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: ['']
  });

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.fetchAccountInformation();
      }
    });
  }

  ngOnDestroy() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
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

  onCountryChange(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const countryCode = selectElement.value;

    if (!countryCode) return;

    this.isLoadingFormat = true;
    this.bankAccountFormat = null;
    this.clearDynamicValidators();

    this.authService.getBankAccountFormat(countryCode).subscribe({
      next: (res) => {
        this.bankAccountFormat = res.bankAccountFormat as any;
        this.applyDynamicValidators();
        this.setupAsyncValidation();
        this.isLoadingFormat = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingFormat = false;
        this.snack.open('Error loading bank format for selected country', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  clearDynamicValidators() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
    this.isAccountFormatValid = false;
    this.accountFormatError = '';
    this.isCheckingAccountFormat = false;

    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      this.form.get(field)?.clearValidators();
      this.form.get(field)?.setValue('');
      this.form.get(field)?.updateValueAndValidity();
    });
  }

  applyDynamicValidators() {
    if (this.bankAccountFormat === 'iban') {
      this.form.get('iban')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      this.form.get('accountNumber')?.setValidators([Validators.required]);
      this.form.get('routingNumber')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      this.form.get('accountNumber')?.setValidators([Validators.required]);
      this.form.get('sortCode')?.setValidators([Validators.required]);
    }

    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      this.form.get(field)?.updateValueAndValidity();
    });
  }

  setupAsyncValidation() {
      let controlsToWatch: any[] = [];

      if (this.bankAccountFormat === 'iban') {
        controlsToWatch = [this.form.get('iban')];
      } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
        controlsToWatch = [this.form.get('accountNumber'), this.form.get('routingNumber')];
      } else if (this.bankAccountFormat === 'accountNumberSortCode') {
        controlsToWatch = [this.form.get('accountNumber'), this.form.get('sortCode')];
      }

      if (controlsToWatch.length === 0) return;

      this.validationSub = combineLatest(
        controlsToWatch.map(c => c.valueChanges.pipe(startWith(c.value)))
      ).pipe(
        debounceTime(1000),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        tap(() => {
          const allFilled = controlsToWatch.every(c => c?.value && c.valid);
          if (!allFilled) {
            this.isAccountFormatValid = false;
            this.isCheckingAccountFormat = false;
            this.accountFormatError = '';
            this.cdr.detectChanges();
          } else {
            this.isCheckingAccountFormat = true;
            this.accountFormatError = '';
            this.cdr.detectChanges();
          }
        }),
        filter(() => controlsToWatch.every(c => c?.value && c.valid)),
        switchMap(() => {
          const req: any = {
            bankAccountFormat: this.bankAccountFormat,
            counterpartyCountry: this.form.value.counterpartyCountry,
            iban: this.form.value.iban || '',
            accountNumber: this.form.value.accountNumber || '',
            routingNumber: this.form.value.routingNumber || '',
            sortCode: this.form.value.sortCode || ''
          };
          return this.authService.isBankAccountValid(req).pipe(
            catchError(() => of({ isBankAccountValid: 'false' }))
          );
        })
      ).subscribe((res) => {
        this.isCheckingAccountFormat = false;
        if (res.isBankAccountValid === 'true' || res.isBankAccountValid === true as any) {
          this.isAccountFormatValid = true;
          this.accountFormatError = '';
        } else {
          this.isAccountFormatValid = false;
          this.accountFormatError = 'Invalid account format or checksum.';
        }
        this.cdr.detectChanges();
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

  private buildTransferRequest(sdkOutput: string): InitiateTransferRequest {
    const minorUnitAmount = Math.round(this.form.value.amount! * 100);
    const formVals = this.form.value;

    return {
      sdkOutput: String(sdkOutput),
      amount: minorUnitAmount,
      reference: formVals.reference || '',
      userId: Number(this.userId),
      transferType: formVals.transferType!,
      counterpartyCountry: formVals.counterpartyCountry!,

      iban: this.bankAccountFormat === 'iban' ? formVals.iban! : '',
      accountNumber: this.bankAccountFormat !== 'iban' ? formVals.accountNumber! : '',
      routingNumber: this.bankAccountFormat === 'accountNumberRoutingNumber' ? formVals.routingNumber! : '',
      sortCode: this.bankAccountFormat === 'accountNumberSortCode' ? formVals.sortCode! : ''
    };
  }

  async submit() {
    if (this.form.invalid || !this.bankAccountFormat || !this.isAccountFormatValid) return;

    const country = this.form.value.counterpartyCountry;

    if (country === 'US') {
      this.initiateTransferFlow();
      return;
    }

    this.isProcessing = true;

    const verifyPayload: VerifyCounterpartyNameRequest = {
      accountHolderName: this.form.value.accountHolderName || '',
      iban: this.form.value.iban || '',
      reference: this.form.value.reference || '',
      accountNumber: this.form.value.accountNumber || '',
      sortCode: this.form.value.sortCode || '',
      accountType: this.bankAccountFormat,
      transferType: this.form.value.transferType || '',
      counterpartyCountry: country || ''
    };

    this.authService.verifyCounterpartyName(verifyPayload).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.isProcessing = false;

          if (res.response === 'nameMatch') {
            this.showExactMatchModal = true;
          } else if (res.response === 'partialNameMatch') {
            this.suggestedName = res.name;
            this.showPartialMatchModal = true;
          } else if (res.response === 'noNameMatch') {
            this.showNoMatchModal = true;
          } else {
            this.initiateTransferFlow();
          }

          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.isProcessing = false;
          this.snack.open('Failed to verify counterparty name', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        });
      }
    });
  }

  async initiateTransferFlow() {
    this.isProcessing = true;
    try {
      const scaWebauthn = ScaWebauthn.create({
        relyingPartyName: 'myplatform',
      });

      const sdkOutput = await scaWebauthn.checkAvailability();
      const request = this.buildTransferRequest(String(sdkOutput));

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

  proceedAfterExactMatch() {
    this.showExactMatchModal = false;
    this.initiateTransferFlow();
  }

  acceptSuggestedName() {
    this.showPartialMatchModal = false;
    this.form.patchValue({ accountHolderName: this.suggestedName });
    this.initiateTransferFlow();
  }

  proceedWithRisk() {
    this.showNoMatchModal = false;
    this.initiateTransferFlow();
  }

  modifyInfo() {
    this.showExactMatchModal = false;
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
  }

  cancelEntireTransfer() {
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
    this.resetForm();
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
      const request = this.buildTransferRequest(String(sdkOutput));

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
    this.bankAccountFormat = null;
    this.clearDynamicValidators();
    this.form.reset({
      transferType: 'regular',
      counterpartyCountry: '',
      accountHolderName: ''
    });
  }
}
