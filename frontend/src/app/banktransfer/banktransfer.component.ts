import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';

import { Subscription, combineLatest, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, startWith, catchError, filter } from 'rxjs/operators';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  InitiateTransferRequest,
  InitiateTransferResponse,
  BankAccountInformationResponse,
  VerifyCounterpartyNameRequest,
  StandingOrder,
  StandingOrderCreateRequest,
  StandingOrderInitiateResponse,
  User
} from '../models';
import { AccountService, TransferService, StandingOrderService } from '../services';

@Component({
  selector: 'app-banktransfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    DeviceRegistrationComponent
  ],
  templateUrl: './banktransfer.component.html',
  styleUrl: './banktransfer.component.css'
})
export class BankTransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private soService = inject(StandingOrderService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user: User | null = null;
  accountInfo?: BankAccountInformationResponse;
  hasDevices = signal<boolean | null>(null);

  // ─── Tab management ───
  activeTab: 'oneshot' | 'standing' = 'oneshot';

  // ─── Shared bank format validation state ───
  isLoadingFormat = false;
  bankAccountFormat: 'iban' | 'accountNumberRoutingNumber' | 'accountNumberSortCode' | null = null;
  isCheckingAccountFormat = false;
  isAccountFormatValid = false;
  accountFormatError = '';
  private validationSub?: Subscription;

  // ─── Shared VoP modals ───
  showExactMatchModal = false;
  showPartialMatchModal = false;
  showNoMatchModal = false;
  suggestedName = '';
  private vopContext: 'oneshot' | 'standing' = 'oneshot';

  // ─── One-shot transfer state ───
  oneshotForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    accountHolderName: ['', [Validators.required]],
    transferType: ['regular', [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    reference: [''],
    description: [''],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: ['']
  });

  isOneshotProcessing = false;
  isOneshotSuccess = false;
  showOneshotScaModal = false;
  transferResponse?: InitiateTransferResponse;

  // ─── Standing orders state ───
  standingOrders: StandingOrder[] = [];
  soLoading = true;
  soError = '';
  soView: 'list' | 'create' | 'edit' = 'list';

  createForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    counterpartyName: ['', [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: [''],
    schedule: ['daily', [Validators.required]],
    priority: ['regular', [Validators.required]],
    reference: [''],
    description: [''],
    referenceForBeneficiary: ['']
  });

  isCreating = false;
  scaStatus = '';

  editingOrder: StandingOrder | null = null;
  editForm = this.fb.group({
    reference: [''],
    description: [''],
    referenceForBeneficiary: [''],
    priority: ['regular']
  });
  isSaving = false;

  showSoScaModal = false;
  scaInitiateResult: StandingOrderInitiateResponse | null = null;
  pendingStandingOrder: StandingOrderCreateRequest | null = null;

  // ─────────── Lifecycle ───────────

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
        this.fetchAccountInformation();
        this.checkDevices();
        this.loadStandingOrders();
      }
    });
  }

  ngOnDestroy() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
  }

  // ─────────── Tab switching ───────────

  onTabChange(index: number) {
    this.activeTab = index === 0 ? 'oneshot' : 'standing';
    this.resetBankFormatState();
  }

  // ─────────── Shared data loading ───────────

  loadUser() {
    this.accountService.getUserById(Number(this.userId)).subscribe({
      next: (user) => {
        this.user = user;
        this.cdr.detectChanges();
      },
      error: () => {
        this.user = null;
        this.cdr.detectChanges();
      }
    });
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

  get userCurrency(): string {
    return this.user?.currencyCode || 'EUR';
  }

  // ─────────── Shared bank format validation ───────────

  private get activeForm(): FormGroup<any> {
    return this.activeTab === 'oneshot' ? this.oneshotForm : this.createForm;
  }

  resetBankFormatState() {
    if (this.validationSub) {
      this.validationSub.unsubscribe();
    }
    this.bankAccountFormat = null;
    this.isAccountFormatValid = false;
    this.accountFormatError = '';
    this.isCheckingAccountFormat = false;
    this.isLoadingFormat = false;
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

    const form = this.activeForm;
    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      form.get(field)?.clearValidators();
      form.get(field)?.setValue('');
      form.get(field)?.updateValueAndValidity();
    });
  }

  applyDynamicValidators() {
    const form = this.activeForm;
    if (this.bankAccountFormat === 'iban') {
      form.get('iban')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      form.get('accountNumber')?.setValidators([Validators.required]);
      form.get('routingNumber')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      form.get('accountNumber')?.setValidators([Validators.required]);
      form.get('sortCode')?.setValidators([Validators.required]);
    }

    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      form.get(field)?.updateValueAndValidity();
    });
  }

  setupAsyncValidation() {
    const form = this.activeForm;
    let controlsToWatch: any[] = [];

    if (this.bankAccountFormat === 'iban') {
      controlsToWatch = [form.get('iban')];
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      controlsToWatch = [form.get('accountNumber'), form.get('routingNumber')];
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      controlsToWatch = [form.get('accountNumber'), form.get('sortCode')];
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
          counterpartyCountry: form.value.counterpartyCountry,
          iban: form.value.iban || '',
          accountNumber: form.value.accountNumber || '',
          routingNumber: form.value.routingNumber || '',
          sortCode: form.value.sortCode || ''
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

  // ─────────── Shared VoP modal handlers ───────────

  get vopBeneficiaryName(): string {
    return this.vopContext === 'oneshot'
      ? (this.oneshotForm.value.accountHolderName || '')
      : (this.createForm.value.counterpartyName || '');
  }

  proceedAfterExactMatch() {
    this.showExactMatchModal = false;
    if (this.vopContext === 'oneshot') {
      this.initiateTransferFlow();
    } else {
      this.initiateStandingOrderFlow();
    }
  }

  acceptSuggestedName() {
    this.showPartialMatchModal = false;
    if (this.vopContext === 'oneshot') {
      this.oneshotForm.patchValue({ accountHolderName: this.suggestedName });
      this.initiateTransferFlow();
    } else {
      this.createForm.patchValue({ counterpartyName: this.suggestedName });
      this.initiateStandingOrderFlow();
    }
  }

  proceedWithRisk() {
    this.showNoMatchModal = false;
    if (this.vopContext === 'oneshot') {
      this.initiateTransferFlow();
    } else {
      this.initiateStandingOrderFlow();
    }
  }

  modifyInfo() {
    this.showExactMatchModal = false;
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
  }

  cancelVop() {
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
    if (this.vopContext === 'oneshot') {
      this.resetOneshotForm();
    } else {
      this.showSoList();
    }
  }

  // ═══════════════════════════════════════════
  //  ONE-SHOT TRANSFER
  // ═══════════════════════════════════════════

  private buildTransferRequest(sdkOutput: string): InitiateTransferRequest {
    const minorUnitAmount = Math.round(this.oneshotForm.value.amount! * 100);
    const formVals = this.oneshotForm.value;

    return {
      sdkOutput: String(sdkOutput),
      amount: minorUnitAmount,
      reference: formVals.reference || '',
      description: formVals.description || '',
      userId: Number(this.userId),
      transferType: formVals.transferType!,
      counterpartyCountry: formVals.counterpartyCountry!,
      iban: this.bankAccountFormat === 'iban' ? formVals.iban! : '',
      accountNumber: this.bankAccountFormat !== 'iban' ? formVals.accountNumber! : '',
      routingNumber: this.bankAccountFormat === 'accountNumberRoutingNumber' ? formVals.routingNumber! : '',
      sortCode: this.bankAccountFormat === 'accountNumberSortCode' ? formVals.sortCode! : '',
      counterpartyName: formVals.accountHolderName || ''
    };
  }

  async submitOneshot() {
    if (this.oneshotForm.invalid || !this.bankAccountFormat || !this.isAccountFormatValid) return;

    const country = this.oneshotForm.value.counterpartyCountry;
    this.vopContext = 'oneshot';

    if (country === 'US') {
      this.initiateTransferFlow();
      return;
    }

    this.isOneshotProcessing = true;

    const verifyPayload: VerifyCounterpartyNameRequest = {
      accountHolderName: this.oneshotForm.value.accountHolderName || '',
      iban: this.oneshotForm.value.iban || '',
      reference: this.oneshotForm.value.reference || '',
      accountNumber: this.oneshotForm.value.accountNumber || '',
      sortCode: this.oneshotForm.value.sortCode || '',
      accountType: this.bankAccountFormat,
      transferType: this.oneshotForm.value.transferType || '',
      counterpartyCountry: country || ''
    };

    this.transferService.verifyCounterpartyName(verifyPayload).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.isOneshotProcessing = false;

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
          this.isOneshotProcessing = false;
          this.snack.open('Failed to verify counterparty name', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        });
      }
    });
  }

  async initiateTransferFlow() {
    this.isOneshotProcessing = true;
    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.checkAvailability();
      const request = this.buildTransferRequest(String(sdkOutput));

      this.transferService.initiateTransfer(request).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            if (!res.authParam1) {
              this.isOneshotSuccess = true;
              this.isOneshotProcessing = false;
              this.transferService.invalidateTransactionCache(Number(this.userId));
              this.fetchAccountInformation();
            } else {
              this.transferResponse = res;
              this.showOneshotScaModal = true;
              this.isOneshotProcessing = false;
            }
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.ngZone.run(() => {
            this.isOneshotProcessing = false;
            this.snack.open('Transfer initiation failed', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isOneshotProcessing = false;
      this.snack.open('SCA initialization failed', 'Close', { duration: 3000 });
    }
  }

  declineOneshot() {
    this.showOneshotScaModal = false;
  }

  async approveOneshot() {
    if (!this.transferResponse) return;
    this.isOneshotProcessing = true;

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkInput = this.transferResponse.authParam1;
      const sdkOutput = await scaWebauthn.authenticate(sdkInput);
      const request = this.buildTransferRequest(String(sdkOutput));

      this.transferService.finalizeTransfer(request).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.isOneshotSuccess = true;
            this.showOneshotScaModal = false;
            this.isOneshotProcessing = false;
            this.transferService.invalidateTransactionCache(Number(this.userId));
            this.fetchAccountInformation();
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.ngZone.run(() => {
            this.isOneshotProcessing = false;
            this.snack.open('Transfer finalization failed', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isOneshotProcessing = false;
      this.snack.open('SCA authentication failed', 'Close', { duration: 3000 });
    }
  }

  resetOneshotForm() {
    this.isOneshotSuccess = false;
    this.bankAccountFormat = null;
    this.clearDynamicValidators();
    this.oneshotForm.reset({
      transferType: 'regular',
      counterpartyCountry: '',
      accountHolderName: ''
    });
  }

  // ═══════════════════════════════════════════
  //  STANDING ORDERS
  // ═══════════════════════════════════════════

  loadStandingOrders() {
    this.soLoading = true;
    this.soError = '';
    this.soService.list(Number(this.userId)).subscribe({
      next: (data) => {
        this.standingOrders = data.standingOrders || [];
        this.soLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.soError = err.error?.message || 'Failed to load standing orders';
        this.standingOrders = [];
        this.soLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  showSoCreate() {
    this.soView = 'create';
    this.scaStatus = '';
    this.bankAccountFormat = null;
    this.clearDynamicValidators();
    this.createForm.reset({
      counterpartyCountry: '',
      schedule: 'daily',
      priority: 'regular'
    });
  }

  showSoList() {
    this.soView = 'list';
    this.editingOrder = null;
    this.scaStatus = '';
    this.resetBankFormatState();
    this.loadStandingOrders();
  }

  showSoEdit(order: StandingOrder) {
    this.editingOrder = order;
    this.soView = 'edit';
    this.editForm.patchValue({
      reference: order.reference || '',
      description: order.description || '',
      referenceForBeneficiary: order.referenceForBeneficiary || '',
      priority: order.priorities?.[0] || 'regular'
    });
  }

  onDeleteSo(order: StandingOrder) {
    if (!confirm('Delete this scheduled transfer?')) return;
    this.soService.delete(Number(this.userId), order.id).subscribe({
      next: () => {
        this.snack.open('Scheduled transfer deleted', 'Close', { duration: 3000 });
        this.loadStandingOrders();
      },
      error: (err) => {
        this.snack.open(err.error?.message || 'Failed to delete', 'Close', { duration: 3000 });
      }
    });
  }

  onSaveEdit() {
    if (!this.editingOrder) return;
    this.isSaving = true;

    const patch = {
      reference: this.editForm.value.reference || '',
      description: this.editForm.value.description || '',
      referenceForBeneficiary: this.editForm.value.referenceForBeneficiary || '',
      priorities: [this.editForm.value.priority || 'regular']
    };

    this.soService.update(Number(this.userId), this.editingOrder.id, patch).subscribe({
      next: (updated) => {
        this.editingOrder = updated;
        this.isSaving = false;
        this.snack.open('Scheduled transfer updated', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSaving = false;
        this.snack.open(err.error?.message || 'Failed to update', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  private buildCreatePayload(): StandingOrderCreateRequest {
    const f = this.createForm.value;

    let accountIdentification: any;
    if (this.bankAccountFormat === 'iban') {
      accountIdentification = { type: 'iban', iban: f.iban || '' };
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      accountIdentification = { type: 'usLocal', accountNumber: f.accountNumber || '', routingNumber: f.routingNumber || '' };
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      accountIdentification = { type: 'ukLocal', accountNumber: f.accountNumber || '', sortCode: f.sortCode || '' };
    } else {
      accountIdentification = { type: 'iban', iban: f.iban || '' };
    }

    return {
      amount: {
        currency: this.userCurrency,
        value: Math.round((f.amount || 0) * 100)
      },
      counterparty: {
        bankAccount: {
          accountHolder: { fullName: f.counterpartyName || '' },
          accountIdentification
        }
      },
      schedule: f.schedule || 'daily',
      priorities: [f.priority || 'regular'],
      reference: f.reference || '',
      description: f.description || '',
      referenceForBeneficiary: f.referenceForBeneficiary || ''
    };
  }

  async onCreateSo() {
    if (this.createForm.invalid || !this.bankAccountFormat || !this.isAccountFormatValid) return;

    const country = this.createForm.value.counterpartyCountry;
    this.vopContext = 'standing';

    if (country === 'US') {
      this.initiateStandingOrderFlow();
      return;
    }

    this.isCreating = true;

    const verifyPayload: VerifyCounterpartyNameRequest = {
      accountHolderName: this.createForm.value.counterpartyName || '',
      iban: this.createForm.value.iban || '',
      reference: this.createForm.value.reference || '',
      accountNumber: this.createForm.value.accountNumber || '',
      sortCode: this.createForm.value.sortCode || '',
      accountType: this.bankAccountFormat,
      transferType: this.createForm.value.priority || 'regular',
      counterpartyCountry: country || ''
    };

    this.transferService.verifyCounterpartyName(verifyPayload).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.isCreating = false;

          if (res.response === 'nameMatch') {
            this.showExactMatchModal = true;
          } else if (res.response === 'partialNameMatch') {
            this.suggestedName = res.name;
            this.showPartialMatchModal = true;
          } else if (res.response === 'noNameMatch') {
            this.showNoMatchModal = true;
          } else {
            this.initiateStandingOrderFlow();
          }

          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.isCreating = false;
          this.snack.open('Failed to verify counterparty name', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        });
      }
    });
  }

  async initiateStandingOrderFlow() {
    this.isCreating = true;
    this.scaStatus = '';

    const standingOrder = this.buildCreatePayload();
    this.pendingStandingOrder = standingOrder;

    try {
      this.scaStatus = 'Checking SCA availability...';
      this.cdr.detectChanges();
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutputInit = await scaWebauthn.checkAvailability();

      this.scaStatus = 'Initiating scheduled transfer...';
      this.cdr.detectChanges();

      this.soService.initiate(Number(this.userId), standingOrder, String(sdkOutputInit)).subscribe({
        next: (result) => {
          this.ngZone.run(() => {
            if (result.status === 'completed') {
              this.scaStatus = '';
              this.isCreating = false;
              this.snack.open('Scheduled transfer created successfully!', 'Close', { duration: 3000 });
              this.showSoList();
            } else if (result.status === 'sca_required') {
              this.scaInitiateResult = result;
              this.scaStatus = 'SCA authentication required...';
              this.showSoScaModal = true;
              this.isCreating = false;
            } else {
              this.scaStatus = '';
              this.isCreating = false;
              this.snack.open('Unexpected response', 'Close', { duration: 3000 });
            }
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isCreating = false;
            this.scaStatus = '';
            this.snack.open(err.error?.message || 'Failed to create scheduled transfer', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isCreating = false;
      this.scaStatus = '';
      this.snack.open('SCA initialization failed', 'Close', { duration: 3000 });
      this.cdr.detectChanges();
    }
  }

  async approveSoScaChallenge() {
    if (!this.scaInitiateResult || !this.pendingStandingOrder) return;
    this.isCreating = true;

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkInput = this.scaInitiateResult.authParam1!;
      this.scaStatus = 'Authenticating (WebAuthn)...';
      this.cdr.detectChanges();

      const sdkOutput = await scaWebauthn.authenticate(sdkInput);

      this.scaStatus = 'Finalizing scheduled transfer...';
      this.cdr.detectChanges();

      this.soService.finalize(Number(this.userId), this.pendingStandingOrder, String(sdkOutput)).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showSoScaModal = false;
            this.isCreating = false;
            this.scaStatus = '';
            this.snack.open('Scheduled transfer created successfully!', 'Close', { duration: 3000 });
            this.showSoList();
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isCreating = false;
            this.scaStatus = '';
            this.snack.open(err.error?.message || 'Failed to finalize scheduled transfer', 'Close', { duration: 3000 });
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isCreating = false;
      this.scaStatus = '';
      this.snack.open('SCA authentication failed', 'Close', { duration: 3000 });
      this.cdr.detectChanges();
    }
  }

  cancelSoSca() {
    this.showSoScaModal = false;
    this.scaStatus = '';
    this.isCreating = false;
  }

  getScheduleLabel(schedule: string): string {
    const labels: Record<string, string> = {
      daily: 'Daily',
      weekdays: 'Weekdays',
      weekly: 'Weekly',
      monthly: 'Monthly'
    };
    return labels[schedule] || schedule;
  }
}
