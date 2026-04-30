import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';

import { Subject, Subscription, combineLatest, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, startWith, catchError, filter } from 'rxjs/operators';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  InitiateTransferRequest,
  InitiateTransferResponse,
  BankAccountInformationResponse,
  VerifyCounterpartyNameRequest,
  CounterpartyVerificationResponse
} from "../models";
import { AccountService, TransferService } from "../services";

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    DeviceRegistrationComponent
  ],
  templateUrl: './transfer.component.html',
  styleUrl: './transfer.component.css'
})
export class TransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  accountInfo?: BankAccountInformationResponse;
  hasDevices = signal<boolean | null>(null);

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
        this.checkDevices();
      }
    });
  }

  ngOnDestroy() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
  }

  fetchAccountInformation() {
    this.accountService.getBankAccountInformation(Number(this.userId)).subscribe({
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

    this.transferService.getBankAccountFormat(countryCode).subscribe({
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
          return this.transferService.isBankAccountValid(req).pipe(
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
    this.accountService.getRibPdf(Number(this.userId)).subscribe({
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

    this.transferService.verifyCounterpartyName(verifyPayload).subscribe({
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

      this.transferService.initiateTransfer(request).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            if (!res.authParam1) {
              this.isSuccess = true;
              this.isProcessing = false;
              this.fetchAccountInformation();
            } else {
              this.transferResponse = res;
              this.showModal = true;
              this.isProcessing = false;
            }
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

      this.transferService.finalizeTransfer(request).subscribe({
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

  checkDevices() {
    this.transferService.listDevices(Number(this.userId)).subscribe({
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

  onDeviceRegistered() {
    this.hasDevices.set(true);
    this.snack.open('Device registered successfully! You can now make transfers.', 'Close', { duration: 4000 });
    this.cdr.detectChanges();
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
