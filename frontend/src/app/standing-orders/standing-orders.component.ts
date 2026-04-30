import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, NgZone, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';

import { Subscription, combineLatest, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, startWith, catchError, filter } from 'rxjs/operators';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  StandingOrder,
  StandingOrderCreateRequest,
  StandingOrderInitiateResponse,
  User,
  VerifyCounterpartyNameRequest
} from '../models';
import { StandingOrderService, AccountService, TransferService } from '../services';

@Component({
  selector: 'app-standing-orders',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    DeviceRegistrationComponent
  ],
  templateUrl: './standing-orders.component.html',
  styleUrl: './standing-orders.component.css'
})
export class StandingOrdersComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private soService = inject(StandingOrderService);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user: User | null = null;
  hasDevices = signal<boolean | null>(null);
  standingOrders: StandingOrder[] = [];
  loading = true;
  error = '';

  // Views: 'list' | 'create' | 'edit'
  view: 'list' | 'create' | 'edit' = 'list';

  // Create form
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
  isLoadingFormat = false;
  bankAccountFormat: 'iban' | 'accountNumberRoutingNumber' | 'accountNumberSortCode' | null = null;
  isCheckingAccountFormat = false;
  isAccountFormatValid = false;
  accountFormatError = '';
  private validationSub?: Subscription;

  // VoP modals
  showExactMatchModal = false;
  showPartialMatchModal = false;
  showNoMatchModal = false;
  suggestedName = '';

  // Edit
  editingOrder: StandingOrder | null = null;
  editForm = this.fb.group({
    reference: [''],
    description: [''],
    referenceForBeneficiary: [''],
    priority: ['regular']
  });
  isSaving = false;

  // SCA modal
  showScaModal = false;
  scaInitiateResult: StandingOrderInitiateResponse | null = null;
  pendingStandingOrder: StandingOrderCreateRequest | null = null;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
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
    this.snack.open('Device registered successfully!', 'Close', { duration: 4000 });
    this.cdr.detectChanges();
  }

  get userCurrency(): string {
    return this.user?.currencyCode || 'EUR';
  }

  loadStandingOrders() {
    this.loading = true;
    this.error = '';
    this.soService.list(Number(this.userId)).subscribe({
      next: (data) => {
        this.standingOrders = data.standingOrders || [];
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load standing orders';
        this.standingOrders = [];
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  showCreate() {
    this.view = 'create';
    this.scaStatus = '';
    this.bankAccountFormat = null;
    this.clearDynamicValidators();
    this.createForm.reset({
      counterpartyCountry: '',
      schedule: 'daily',
      priority: 'regular'
    });
  }

  // ---- Country / bank format validation (same as TransferComponent) ----

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
      this.createForm.get(field)?.clearValidators();
      this.createForm.get(field)?.setValue('');
      this.createForm.get(field)?.updateValueAndValidity();
    });
  }

  applyDynamicValidators() {
    if (this.bankAccountFormat === 'iban') {
      this.createForm.get('iban')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      this.createForm.get('accountNumber')?.setValidators([Validators.required]);
      this.createForm.get('routingNumber')?.setValidators([Validators.required]);
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      this.createForm.get('accountNumber')?.setValidators([Validators.required]);
      this.createForm.get('sortCode')?.setValidators([Validators.required]);
    }

    ['iban', 'accountNumber', 'routingNumber', 'sortCode'].forEach(field => {
      this.createForm.get(field)?.updateValueAndValidity();
    });
  }

  setupAsyncValidation() {
    let controlsToWatch: any[] = [];

    if (this.bankAccountFormat === 'iban') {
      controlsToWatch = [this.createForm.get('iban')];
    } else if (this.bankAccountFormat === 'accountNumberRoutingNumber') {
      controlsToWatch = [this.createForm.get('accountNumber'), this.createForm.get('routingNumber')];
    } else if (this.bankAccountFormat === 'accountNumberSortCode') {
      controlsToWatch = [this.createForm.get('accountNumber'), this.createForm.get('sortCode')];
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
          counterpartyCountry: this.createForm.value.counterpartyCountry,
          iban: this.createForm.value.iban || '',
          accountNumber: this.createForm.value.accountNumber || '',
          routingNumber: this.createForm.value.routingNumber || '',
          sortCode: this.createForm.value.sortCode || ''
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

  showList() {
    this.view = 'list';
    this.editingOrder = null;
    this.scaStatus = '';
    this.loadStandingOrders();
  }

  showEdit(order: StandingOrder) {
    this.editingOrder = order;
    this.view = 'edit';
    this.editForm.patchValue({
      reference: order.reference || '',
      description: order.description || '',
      referenceForBeneficiary: order.referenceForBeneficiary || '',
      priority: order.priorities?.[0] || 'regular'
    });
  }

  onDelete(order: StandingOrder) {
    if (!confirm('Delete this standing order?')) return;
    this.soService.delete(Number(this.userId), order.id).subscribe({
      next: () => {
        this.snack.open('Standing order deleted', 'Close', { duration: 3000 });
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
        this.snack.open('Standing order updated', 'Close', { duration: 3000 });
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

  async onCreate() {
    if (this.createForm.invalid || !this.bankAccountFormat || !this.isAccountFormatValid) return;

    const country = this.createForm.value.counterpartyCountry;

    // Skip VoP for US (not supported)
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

  proceedAfterExactMatch() {
    this.showExactMatchModal = false;
    this.initiateStandingOrderFlow();
  }

  acceptSuggestedName() {
    this.showPartialMatchModal = false;
    this.createForm.patchValue({ counterpartyName: this.suggestedName });
    this.initiateStandingOrderFlow();
  }

  proceedWithRisk() {
    this.showNoMatchModal = false;
    this.initiateStandingOrderFlow();
  }

  modifyInfo() {
    this.showExactMatchModal = false;
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
  }

  cancelCreate() {
    this.showPartialMatchModal = false;
    this.showNoMatchModal = false;
    this.showList();
  }

  async initiateStandingOrderFlow() {
    this.isCreating = true;
    this.scaStatus = '';

    const standingOrder = this.buildCreatePayload();
    this.pendingStandingOrder = standingOrder;

    try {
      // Step 1: Check SCA availability
      this.scaStatus = 'Checking SCA availability...';
      this.cdr.detectChanges();
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutputInit = await scaWebauthn.checkAvailability();

      // Step 2: Initiate standing order (may trigger SCA challenge)
      this.scaStatus = 'Initiating standing order...';
      this.cdr.detectChanges();

      this.soService.initiate(Number(this.userId), standingOrder, String(sdkOutputInit)).subscribe({
        next: (result) => {
          this.ngZone.run(() => {
            if (result.status === 'completed') {
              this.scaStatus = '';
              this.isCreating = false;
              this.snack.open('Standing order created successfully!', 'Close', { duration: 3000 });
              this.showList();
            } else if (result.status === 'sca_required') {
              this.scaInitiateResult = result;
              this.scaStatus = 'SCA authentication required...';
              this.showScaModal = true;
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
            this.snack.open(err.error?.message || 'Failed to create standing order', 'Close', { duration: 3000 });
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

  async approveScaChallenge() {
    if (!this.scaInitiateResult || !this.pendingStandingOrder) return;
    this.isCreating = true;

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkInput = this.scaInitiateResult.authParam1!;
      this.scaStatus = 'Authenticating (WebAuthn)...';
      this.cdr.detectChanges();

      const sdkOutput = await scaWebauthn.authenticate(sdkInput);

      this.scaStatus = 'Finalizing standing order...';
      this.cdr.detectChanges();

      this.soService.finalize(Number(this.userId), this.pendingStandingOrder, String(sdkOutput)).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showScaModal = false;
            this.isCreating = false;
            this.scaStatus = '';
            this.snack.open('Standing order created successfully!', 'Close', { duration: 3000 });
            this.showList();
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isCreating = false;
            this.scaStatus = '';
            this.snack.open(err.error?.message || 'Failed to finalize standing order', 'Close', { duration: 3000 });
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

  cancelSca() {
    this.showScaModal = false;
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
