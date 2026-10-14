import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Subscription, combineLatest, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, startWith, catchError, filter, map } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  BankAccountFormat,
  BankAccountInformationResponse,
  BatchTransferRequest,
  BatchTransferResponse,
  RecipientCountry,
  TestAccount,
  TransferRouteRequest,
  User,
  VerifyCounterpartyNameRequest
} from '../models';
import { AccountService, TransferService } from '../services';
import { RecipientCountryPickerComponent } from '../recipient-country-picker/recipient-country-picker.component';
import { TransferSpeedPickerComponent } from '../transfer-speed-picker/transfer-speed-picker.component';

@Component({
  selector: 'app-batch-transfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    DeviceRegistrationComponent,
    RecipientCountryPickerComponent,
    TransferSpeedPickerComponent
  ],
  templateUrl: './batch-transfer.component.html',
  styleUrl: './batch-transfer.component.css'
})
export class BatchTransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user: User | null = null;
  accountInfo?: BankAccountInformationResponse;
  hasDevices = signal<boolean | null>(null);

  userCurrency = 'EUR';
  recipientCountries: RecipientCountry[] = [];
  bankAccountFormat: BankAccountFormat | null = null;
  isCheckingAccountFormat = false;
  isAccountFormatValid = false;
  accountFormatError = '';
  private validationSub?: Subscription;

  // Bank details the transfer routes are calculated for, set once they pass the format check.
  routeBeneficiary: TransferRouteRequest | null = null;

  // VoP
  showExactMatchModal = false;
  showPartialMatchModal = false;
  showNoMatchModal = false;
  suggestedName = '';

  transferForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    counterpartyName: ['', [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: [''],
    transferType: [null as string | null, [Validators.required]],
    reference: [''],
    description: ['']
  });

  isAdding = false;
  isLoadingPending = false;
  pendingTransfers: BatchTransferResponse[] = [];
  pendingNotFoundCount = 0;

  isApproving = false;
  isApprovalSuccess = false;
  approvedCount = 0;
  showScaModal = false;
  scaStatus = '';
  private approveAuthParam1 = '';

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
        this.loadRecipientCountries();
        this.fetchAccountInformation();
        this.checkDevices();
        this.loadPendingTransfers();
      }
    });
  }

  loadUser() {
    this.accountService.getUserById(this.userId).subscribe({
      next: (user) => {
        this.user = user;
        this.userCurrency = user.currencyCode || 'EUR';
        this.cdr.detectChanges();
      },
      error: () => {
        this.user = null;
        this.cdr.detectChanges();
      }
    });
  }

  loadRecipientCountries() {
    this.transferService.getRecipientCountries(this.userId).subscribe({
      next: (countries) => {
        this.recipientCountries = countries;
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to load recipient countries', 'Close', { duration: 3000 });
      }
    });
  }

  fetchAccountInformation() {
    this.accountService.getBankAccountInformation(this.userId).subscribe({
      next: (info) => {
        this.accountInfo = info;
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to load account information', 'Close', { duration: 3000 });
      }
    });
  }

  checkDevices() {
    this.transferService.listDevices(this.userId).subscribe({
      next: (devices) => {
        this.hasDevices.set(devices && devices.length > 0);
        this.cdr.detectChanges();
      },
      error: () => {
        this.hasDevices.set(false);
        this.cdr.detectChanges();
      }
    });
  }

  loadPendingTransfers() {
    this.isLoadingPending = true;
    this.pendingNotFoundCount = 0;
    this.cdr.detectChanges();

    this.transferService.getPendingBatchTransfers(this.userId).subscribe({
      next: (res: any) => {
        try {
          let transfers: any[] = [];
          if (res && res.transfers && Array.isArray(res.transfers)) {
            transfers = res.transfers;
          } else if (Array.isArray(res)) {
            transfers = res;
          }
          this.pendingNotFoundCount = res?.notFoundCount || 0;
          const existingIds = new Set(this.pendingTransfers.map((t: any) => t.id));
          transfers.forEach((t: any) => {
            if (!existingIds.has(t.id)) {
              this.pendingTransfers.push(t);
            }
          });
        } catch (e) {
          console.error('[loadPendingTransfers] parse error:', e);
        }
        this.isLoadingPending = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingPending = false;
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices.set(true);
    this.snack.open('Device registered successfully! You can now make batch transfers.', 'Close', { duration: 4000 });
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
  }

  // ─────────── Bank format validation ───────────

  onCountryChange(countryCode: string) {
    this.clearDynamicValidators();
    this.bankAccountFormat = this.findRecipientCountry(countryCode)?.bankAccountFormat ?? null;
    if (!this.bankAccountFormat) return;

    this.applyDynamicValidators();
    this.setupAsyncValidation();
  }

  get testAccount(): TestAccount | null {
    return this.findRecipientCountry(this.transferForm.value.counterpartyCountry)?.testAccount ?? null;
  }

  fillTestAccount() {
    const testAccount = this.testAccount;
    if (testAccount) {
      this.transferForm.patchValue(testAccount);
    }
  }

  private findRecipientCountry(countryCode: string | null | undefined): RecipientCountry | undefined {
    return this.recipientCountries.find(country => country.countryCode === countryCode);
  }

  clearDynamicValidators() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
    this.isAccountFormatValid = false;
    this.accountFormatError = '';
    this.isCheckingAccountFormat = false;
    this.routeBeneficiary = null;

    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      this.transferForm.get(field)?.clearValidators();
      this.transferForm.get(field)?.setValue('');
      this.transferForm.get(field)?.updateValueAndValidity();
    });
  }

  applyDynamicValidators() {
    if (this.bankAccountFormat === 'iban') {
      this.transferForm.get('iban')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      this.transferForm.get('accountNumber')?.setValidators([Validators.required]);
      this.transferForm.get('routingNumber')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      this.transferForm.get('accountNumber')?.setValidators([Validators.required]);
      this.transferForm.get('sortCode')?.setValidators([Validators.required]);
    }

    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      this.transferForm.get(field)?.updateValueAndValidity();
    });
  }

  setupAsyncValidation() {
    let controlsToWatch: any[] = [];

    if (this.bankAccountFormat === 'iban') {
      controlsToWatch = [this.transferForm.get('iban')];
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      controlsToWatch = [this.transferForm.get('accountNumber'), this.transferForm.get('routingNumber')];
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      controlsToWatch = [this.transferForm.get('accountNumber'), this.transferForm.get('sortCode')];
    }

    if (controlsToWatch.length === 0) return;

    this.validationSub = combineLatest(
      controlsToWatch.map(c => c.valueChanges.pipe(startWith(c.value)))
    ).pipe(
      debounceTime(1000),
      distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
      tap(() => {
        this.routeBeneficiary = null;
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
          counterpartyCountry: this.transferForm.value.counterpartyCountry,
          iban: this.transferForm.value.iban || '',
          accountNumber: this.transferForm.value.accountNumber || '',
          routingNumber: this.transferForm.value.routingNumber || '',
          sortCode: this.transferForm.value.sortCode || ''
        };
        return this.transferService.isBankAccountValid(req).pipe(
          catchError(() => of({ isBankAccountValid: 'false' })),
          map(res => ({ res, req }))
        );
      })
    ).subscribe(({ res, req }) => {
      this.isCheckingAccountFormat = false;
      if (res.isBankAccountValid === 'true' || res.isBankAccountValid === true as any) {
        this.isAccountFormatValid = true;
        this.accountFormatError = '';
        this.routeBeneficiary = {
          counterpartyCountry: req.counterpartyCountry,
          iban: req.iban,
          accountNumber: req.accountNumber,
          routingNumber: req.routingNumber,
          sortCode: req.sortCode
        };
      } else {
        this.isAccountFormatValid = false;
        this.accountFormatError = 'Invalid account format or checksum.';
      }
      this.cdr.detectChanges();
    });
  }

  resetBankFormatState() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
    this.bankAccountFormat = null;
    this.isAccountFormatValid = false;
    this.accountFormatError = '';
    this.isCheckingAccountFormat = false;
    this.routeBeneficiary = null;
  }

  // ─────────── VoP (Verification of Payee) ───────────

  submitTransfer() {
    if (this.transferForm.invalid || !this.bankAccountFormat || !this.isAccountFormatValid) return;

    const country = this.transferForm.value.counterpartyCountry;

    if (!this.findRecipientCountry(country)?.payeeVerification) {
      this.addToBatch();
      return;
    }

    this.isAdding = true;
    this.cdr.detectChanges();

    const verifyPayload: VerifyCounterpartyNameRequest = {
      accountHolderName: this.transferForm.value.counterpartyName || '',
      iban: this.transferForm.value.iban || '',
      reference: this.transferForm.value.reference || '',
      accountNumber: this.transferForm.value.accountNumber || '',
      sortCode: this.transferForm.value.sortCode || '',
      accountType: this.bankAccountFormat,
      transferType: this.transferForm.value.transferType || '',
      counterpartyCountry: country || ''
    };

    this.transferService.verifyCounterpartyName(verifyPayload).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.isAdding = false;

          if (res.response === 'nameMatch') {
            this.showExactMatchModal = true;
          } else if (res.response === 'partialNameMatch') {
            this.suggestedName = res.name;
            this.showPartialMatchModal = true;
          } else if (res.response === 'noNameMatch') {
            this.showNoMatchModal = true;
          } else {
            this.addToBatch();
          }

          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.isAdding = false;
          this.snack.open('Failed to verify counterparty name', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        });
      }
    });
  }

  proceedAfterExactMatch() {
    this.showExactMatchModal = false;
    this.addToBatch();
  }

  acceptSuggestedName() {
    this.showPartialMatchModal = false;
    this.transferForm.patchValue({ counterpartyName: this.suggestedName });
    this.addToBatch();
  }

  proceedWithRisk() {
    this.showNoMatchModal = false;
    this.addToBatch();
  }

  modifyInfo() {
    this.showExactMatchModal = false;
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
  }

  cancelVop() {
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
  }

  // ─────────── Add to batch ───────────

  addToBatch() {
    this.isAdding = true;
    this.cdr.detectChanges();

    const formVals = this.transferForm.value;
    const minorUnitAmount = Math.round(formVals.amount! * 100);

    const request: BatchTransferRequest = {
      userId: this.userId,
      amount: minorUnitAmount,
      reference: formVals.reference || '',
      description: formVals.description || '',
      transferType: formVals.transferType || 'regular',
      counterpartyCountry: formVals.counterpartyCountry || '',
      counterpartyName: formVals.counterpartyName || '',
      iban: this.bankAccountFormat === 'iban' ? (formVals.iban || '') : '',
      accountNumber: this.bankAccountFormat !== 'iban' ? (formVals.accountNumber || '') : '',
      routingNumber: this.bankAccountFormat === 'accountNumberRoutingNumber' ? (formVals.routingNumber || '') : '',
      sortCode: this.bankAccountFormat === 'accountNumberSortCode' ? (formVals.sortCode || '') : ''
    };

    this.transferService.initiateBatchTransfer(request).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.pendingTransfers.push(res);
          this.isAdding = false;
          this.snack.open('Transfer added to batch', 'Close', { duration: 2000 });
          this.resetForm();
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.isAdding = false;
          const message = err.status === 400 && err.error?.error
            ? err.error.error
            : (err.error?.message || 'Failed to add transfer to batch');
          this.snack.open(message, 'Close', { duration: 5000 });
          this.cdr.detectChanges();
        });
      }
    });
  }

  removeFromBatch(index: number) {
    this.pendingTransfers.splice(index, 1);
    this.cdr.detectChanges();
  }

  clearBatch() {
    this.pendingTransfers = [];
    this.cdr.detectChanges();
  }

  async approveAll() {
    if (this.pendingTransfers.length === 0) return;

    this.isApproving = true;
    this.scaStatus = 'Checking SCA availability...';
    this.cdr.detectChanges();

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.checkAvailability();

      this.scaStatus = 'Initiating approval...';
      this.cdr.detectChanges();

      const transferIds = this.pendingTransfers.map(t => t.id);

      this.transferService.approveTransfers(this.userId, transferIds, String(sdkOutput)).subscribe({
        next: (res: any) => {
          this.ngZone.run(() => {
            if (res.status === 'transfers_not_ready') {
              this.isApproving = false;
              this.scaStatus = '';
              this.snack.open(res.message || 'Some transfers are not yet propagated. Please wait 1 minute and try again.', 'Close', { duration: 6000 });
            } else if (res.status === 'sca_required' && res.authParam1) {
              this.approveAuthParam1 = res.authParam1;
              this.showScaModal = true;
              this.scaStatus = '';
              this.isApproving = false;
            } else {
              this.onApprovalComplete();
            }
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isApproving = false;
            this.scaStatus = '';
            this.snack.open(err.error?.message || 'Failed to initiate approval', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isApproving = false;
      this.scaStatus = '';
      this.snack.open('SCA initialization failed', 'Close', { duration: 3000 });
      this.cdr.detectChanges();
    }
  }

  declineApproval() {
    this.showScaModal = false;
    this.approveAuthParam1 = '';
    this.scaStatus = '';
  }

  async confirmApproval() {
    if (!this.approveAuthParam1) return;

    this.isApproving = true;
    this.scaStatus = 'Authenticating (WebAuthn)...';
    this.cdr.detectChanges();

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.authenticate(this.approveAuthParam1);

      this.scaStatus = 'Finalizing approval...';
      this.cdr.detectChanges();

      const transferIds = this.pendingTransfers.map(t => t.id);

      this.transferService.finalizeApproval(this.userId, transferIds, String(sdkOutput)).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showScaModal = false;
            this.onApprovalComplete();
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isApproving = false;
            this.scaStatus = '';
            this.snack.open(err.error?.message || 'Failed to finalize approval', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isApproving = false;
      this.scaStatus = '';
      this.snack.open('SCA authentication failed', 'Close', { duration: 3000 });
      this.cdr.detectChanges();
    }
  }

  private onApprovalComplete() {
    this.approvedCount = this.pendingTransfers.length;
    this.isApprovalSuccess = true;
    this.isApproving = false;
    this.scaStatus = '';
    this.showScaModal = false;
    this.transferService.invalidateTransactionCache(this.userId);
    this.fetchAccountInformation();
    this.snack.open(`${this.approvedCount} transfer(s) approved successfully!`, 'Close', { duration: 4000 });
  }

  resetAll() {
    this.pendingTransfers = [];
    this.isApprovalSuccess = false;
    this.approvedCount = 0;
    this.approveAuthParam1 = '';
    this.resetForm();
    this.cdr.detectChanges();
  }

  private resetForm() {
    const currentCountry = this.transferForm.value.counterpartyCountry;
    this.clearDynamicValidators();
    this.transferForm.reset({
      transferType: null,
      counterpartyCountry: currentCountry
    });
    if (currentCountry) {
      this.applyDynamicValidators();
      this.setupAsyncValidation();
    }
  }

  formatAmount(minorUnits: number): string {
    return (Math.abs(minorUnits) / 100).toFixed(2);
  }

  getBatchTotal(): string {
    const byCurrency = new Map<string, number>();
    for (const t of this.pendingTransfers) {
      const curr = t.currency || 'EUR';
      byCurrency.set(curr, (byCurrency.get(curr) || 0) + t.amount);
    }
    const parts: string[] = [];
    for (const [curr, total] of byCurrency) {
      parts.push(`${(total / 100).toFixed(2)} ${curr}`);
    }
    return parts.join(' + ') || '0.00';
  }
}
