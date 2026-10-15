import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';
import { AccountSetupStateComponent, LoadState, combineLoadStates, failedLoadState } from '../device/account-setup-state.component';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  BankAccountInformationResponse,
  BatchApproveResponse,
  BatchTransferRequest,
  BatchTransferResponse,
  PendingBatchTransfersResponse,
  RecipientCountry,
  TestAccount,
  User,
  VerifyCounterpartyNameRequest
} from '../models';
import { AccountService, TransferService } from '../services';
import { ConfirmService, MoneyPipe, formatMoney, httpErrorMessage, scaErrorMessage, toMinorUnits } from '../shared';
import { RecipientCountryPickerComponent } from '../recipient-country-picker/recipient-country-picker.component';
import { TransferSpeedPickerComponent } from '../transfer-speed-picker/transfer-speed-picker.component';
import { BankDetailsCheck, speedBlockReason } from '../banktransfer/bank-details';
import { BankDetailsFieldsComponent } from '../banktransfer/bank-details-fields.component';
import { formatDateTime } from '../banktransfer/format-date';

type PageState = LoadState | 'no-device';

interface ApprovalRecap {
  count: number;
  total: string;
  transfers: BatchTransferResponse[];
  date: string;
}

@Component({
  selector: 'app-batch-transfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    A11yModule,
    MaterialModule,
    MoneyPipe,
    DeviceRegistrationComponent,
    AccountSetupStateComponent,
    RecipientCountryPickerComponent,
    TransferSpeedPickerComponent,
    BankDetailsFieldsComponent
  ],
  templateUrl: './batch-transfer.component.html',
  styleUrl: './batch-transfer.component.css'
})
export class BatchTransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private confirmService = inject(ConfirmService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user: User | null = null;
  accountInfo?: BankAccountInformationResponse;

  accountState: LoadState = 'loading';
  devicesState: LoadState = 'loading';
  hasDevices = false;
  loadErrorMessage = '';

  recipientCountries: RecipientCountry[] = [];
  countriesError = '';

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
  readonly bank = new BankDetailsCheck(this.transferForm, this.transferService, () => this.cdr.detectChanges());

  isAdding = false;
  isLoadingPending = false;
  pendingError = '';
  pendingTransfers: BatchTransferResponse[] = [];
  pendingNotFoundCount = 0;
  cancellingIds = new Set<string>();
  // Cancelled or approved transfers can still be listed as pending for a while: never show them again.
  private hiddenIds = new Set<string>();

  isApproving = false;
  approvalRecap: ApprovalRecap | null = null;
  showScaModal = false;
  scaStatus = '';
  private approveAuthParam1 = '';
  private approvingIds: string[] = [];

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

  ngOnDestroy() {
    this.bank.destroy();
  }

  // ─────────── Page state ───────────

  get pageState(): PageState {
    const state = combineLoadStates(this.accountState, this.devicesState);
    return state === 'ready' && !this.hasDevices ? 'no-device' : state;
  }

  get setupState(): LoadState {
    const state = this.pageState;
    return state === 'no-device' ? 'ready' : state;
  }

  retryPage() {
    if (this.accountState !== 'ready') this.fetchAccountInformation();
    if (this.devicesState !== 'ready') this.checkDevices();
    if (!this.recipientCountries.length) this.loadRecipientCountries();
  }

  get userCurrency(): string {
    return this.accountInfo?.currency || this.user?.currencyCode || 'EUR';
  }

  loadUser() {
    this.accountService.getUserById(this.userId).subscribe({
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

  loadRecipientCountries() {
    this.countriesError = '';
    this.transferService.getRecipientCountries(this.userId).subscribe({
      next: (countries) => {
        this.recipientCountries = countries;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.countriesError = httpErrorMessage(err, "Couldn't load the recipient countries.");
        this.cdr.detectChanges();
      }
    });
  }

  fetchAccountInformation(refresh = false) {
    if (!refresh) this.accountState = 'loading';
    this.accountService.getBankAccountInformation(this.userId).subscribe({
      next: (info) => {
        this.accountInfo = info;
        this.accountState = 'ready';
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (!refresh) {
          this.accountState = failedLoadState(err);
          this.loadErrorMessage = httpErrorMessage(err, "Couldn't load your account. Try again.");
        }
        this.cdr.detectChanges();
      }
    });
  }

  checkDevices() {
    this.devicesState = 'loading';
    this.transferService.listDevices(this.userId).subscribe({
      next: (devices) => {
        this.hasDevices = !!devices && devices.length > 0;
        this.devicesState = 'ready';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.devicesState = failedLoadState(err);
        this.loadErrorMessage = httpErrorMessage(err, "Couldn't load your trusted devices. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  loadPendingTransfers() {
    this.isLoadingPending = true;
    this.pendingError = '';
    this.cdr.detectChanges();

    this.transferService.getPendingBatchTransfers(this.userId).subscribe({
      next: (res: PendingBatchTransfersResponse | BatchTransferResponse[]) => {
        const transfers = Array.isArray(res) ? res : (res?.transfers ?? []);
        this.pendingNotFoundCount = Array.isArray(res) ? 0 : (res?.notFoundCount || 0);
        // Transfers added in this session may not be listed yet, so the response is merged rather than replacing the list.
        const existingIds = new Set(this.pendingTransfers.map(t => t.id));
        transfers
          .filter(t => t && !existingIds.has(t.id) && !this.hiddenIds.has(t.id))
          .forEach(t => this.pendingTransfers.push(t));
        this.isLoadingPending = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoadingPending = false;
        this.pendingError = httpErrorMessage(err, "Couldn't load the transfers waiting for approval. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices = true;
    this.snack.open('Device registered. You can now make batch transfers.', 'Close', { duration: 4000, panelClass: 'fintech-snack-success' });
    this.cdr.detectChanges();
  }

  // ─────────── Bank details ───────────

  onCountryChange(countryCode: string) {
    this.bank.setFormat(this.findRecipientCountry(countryCode)?.bankAccountFormat ?? null);
  }

  get testAccount(): TestAccount | null {
    return this.findRecipientCountry(this.transferForm.value.counterpartyCountry)?.testAccount ?? null;
  }

  private findRecipientCountry(countryCode: string | null | undefined): RecipientCountry | undefined {
    return this.recipientCountries.find(country => country.countryCode === countryCode);
  }

  // ─────────── Amounts ───────────

  get amountMinor(): number | null {
    const amount = this.transferForm.value.amount;
    return typeof amount === 'number' && Number.isFinite(amount) ? toMinorUnits(amount, this.userCurrency) : null;
  }

  get exceedsBalance(): boolean {
    const amount = this.amountMinor;
    return !!this.accountInfo && amount !== null && this.accountInfo.currency === this.userCurrency && amount > this.accountInfo.amount;
  }

  private get pendingTotalInAccountCurrency(): number {
    return this.pendingTransfers
      .filter(t => (t.currency || this.userCurrency) === this.accountInfo?.currency)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  }

  /** The batch total, including the transfer being typed when given, is above the available balance. */
  batchExceedsBalance(includeDraft = false): boolean {
    if (!this.accountInfo) return false;
    const draft = includeDraft ? (this.amountMinor ?? 0) : 0;
    return this.pendingTotalInAccountCurrency + draft > this.accountInfo.amount;
  }

  amountErrorMessage(): string {
    const amount = this.transferForm.controls.amount;
    if (amount.errors?.['min'] && (amount.touched || amount.dirty)) {
      return `Enter an amount of at least ${formatMoney(1, this.userCurrency)}.`;
    }
    return '';
  }

  get blockReason(): string {
    const controls = this.transferForm.controls;
    if (controls.amount.invalid) return 'Enter an amount to continue.';
    if (this.exceedsBalance) return 'The amount is higher than your available balance.';
    if (controls.counterpartyName.invalid) return 'Enter the beneficiary name to continue.';
    if (controls.counterpartyCountry.invalid) return 'Choose the recipient country to continue.';
    return this.bank.blockReason || speedBlockReason(controls.transferType);
  }

  getBatchTotal(transfers: BatchTransferResponse[] = this.pendingTransfers): string {
    const byCurrency = new Map<string, number>();
    for (const t of transfers) {
      const currency = t.currency || this.userCurrency;
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + (t.amount || 0));
    }
    const parts = [...byCurrency].map(([currency, total]) => formatMoney(total, currency));
    return parts.join(' + ') || formatMoney(0, this.userCurrency);
  }

  // ─────────── VoP (Verification of Payee) ───────────

  submitTransfer() {
    if (this.blockReason || this.isAdding) return;

    const country = this.transferForm.value.counterpartyCountry;

    if (!this.findRecipientCountry(country)?.payeeVerification) {
      this.addToBatch();
      return;
    }

    this.isAdding = true;
    this.cdr.detectChanges();

    const bank = this.bank.normalized();
    const verifyPayload: VerifyCounterpartyNameRequest = {
      accountHolderName: this.transferForm.value.counterpartyName || '',
      iban: bank.iban,
      reference: this.transferForm.value.reference || '',
      accountNumber: bank.accountNumber,
      sortCode: bank.sortCode,
      accountType: this.bank.format || '',
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
      error: (err) => {
        this.ngZone.run(() => {
          this.isAdding = false;
          this.toastError(httpErrorMessage(err, "Couldn't verify the beneficiary name. Try again."));
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
    this.modifyInfo();
    this.resetForm();
  }

  // ─────────── Add to batch ───────────

  addToBatch() {
    this.isAdding = true;
    this.cdr.detectChanges();

    const formVals = this.transferForm.value;

    const request: BatchTransferRequest = {
      userId: this.userId,
      amount: this.amountMinor ?? 0,
      reference: formVals.reference || '',
      description: formVals.description || '',
      transferType: formVals.transferType || 'regular',
      counterpartyCountry: formVals.counterpartyCountry || '',
      counterpartyName: formVals.counterpartyName || '',
      ...this.bank.normalized()
    };

    this.transferService.initiateBatchTransfer(request).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.pendingTransfers.push({ ...res, currency: res.currency || this.userCurrency });
          this.isAdding = false;
          this.snack.open(
            `${formatMoney(res.amount ?? request.amount, res.currency || this.userCurrency)} to ${res.counterpartyName || request.counterpartyName} added to the batch`,
            'Close',
            { duration: 3000, panelClass: 'fintech-snack-success' }
          );
          this.resetForm();
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.isAdding = false;
          this.toastError(httpErrorMessage(err, "Couldn't add the transfer to the batch. Try again."));
          this.cdr.detectChanges();
        });
      }
    });
  }

  // ─────────── Cancel pending transfers ───────────

  async removeFromBatch(transfer: BatchTransferResponse) {
    const confirmed = await this.confirmService.confirm({
      title: 'Cancel this transfer?',
      message: 'The transfer is cancelled on Adyen and removed from the batch. This cannot be undone.',
      details: [
        { label: 'Beneficiary', value: transfer.counterpartyName || '—' },
        { label: 'Amount', value: formatMoney(transfer.amount, transfer.currency || this.userCurrency) }
      ],
      confirmText: 'Cancel transfer',
      cancelText: 'Keep it',
      danger: true
    });
    if (confirmed) this.cancelTransfers([transfer]);
  }

  async clearBatch() {
    const transfers = [...this.pendingTransfers];
    if (!transfers.length) return;
    const confirmed = await this.confirmService.confirm({
      title: transfers.length === 1 ? 'Cancel 1 transfer?' : `Cancel all ${transfers.length} transfers?`,
      message: 'The transfers are cancelled on Adyen and removed from the batch. This cannot be undone.',
      details: [
        { label: 'Transfers', value: String(transfers.length) },
        { label: 'Total', value: this.getBatchTotal(transfers) }
      ],
      confirmText: transfers.length === 1 ? 'Cancel transfer' : 'Cancel all transfers',
      cancelText: 'Keep them',
      danger: true
    });
    if (confirmed) this.cancelTransfers(transfers);
  }

  private cancelTransfers(transfers: BatchTransferResponse[]) {
    const ids = transfers.map(t => t.id);
    ids.forEach(id => this.cancellingIds.add(id));
    this.cdr.detectChanges();

    this.transferService.cancelBatchTransfers(this.userId, ids).subscribe({
      next: (res) => {
        const cancelled = new Set(res?.transferIds?.length ? res.transferIds : ids);
        cancelled.forEach(id => this.hiddenIds.add(id));
        ids.forEach(id => this.cancellingIds.delete(id));
        this.pendingTransfers = this.pendingTransfers.filter(t => !cancelled.has(t.id));
        const notCancelled = ids.filter(id => !cancelled.has(id)).length;
        if (notCancelled > 0) {
          this.toastError(`${notCancelled} transfer(s) couldn't be cancelled. They may already have been processed.`);
        } else {
          this.snack.open(
            cancelled.size === 1 ? 'Transfer cancelled' : `${cancelled.size} transfers cancelled`,
            'Close',
            { duration: 3000, panelClass: 'fintech-snack-success' }
          );
        }
        this.loadPendingTransfers();
      },
      error: (err) => {
        ids.forEach(id => this.cancellingIds.delete(id));
        this.toastError(httpErrorMessage(err, "Couldn't cancel the transfers. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  get isCancelling(): boolean {
    return this.cancellingIds.size > 0;
  }

  // ─────────── Approval ───────────

  async approveAll() {
    if (this.pendingTransfers.length === 0 || this.isApproving) return;

    this.isApproving = true;
    this.scaStatus = 'Checking passkey availability...';
    this.approvingIds = this.pendingTransfers.map(t => t.id);
    this.cdr.detectChanges();

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.checkAvailability();

      this.scaStatus = 'Preparing the approval...';
      this.cdr.detectChanges();

      this.transferService.approveTransfers(this.userId, this.approvingIds, String(sdkOutput)).subscribe({
        next: (res: BatchApproveResponse) => {
          this.ngZone.run(() => {
            if (res.status === 'transfers_not_ready') {
              this.isApproving = false;
              this.scaStatus = '';
              this.snack.open(
                res.message || 'Some transfers are still being created. Wait about a minute and try again.',
                'Close',
                { duration: 6000, panelClass: 'fintech-snack-error' }
              );
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
            this.toastError(httpErrorMessage(err, "Couldn't start the approval. Try again."));
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.ngZone.run(() => {
        this.isApproving = false;
        this.scaStatus = '';
        this.toastError(scaErrorMessage(e, "Couldn't start the authentication. Try again."));
        this.cdr.detectChanges();
      });
    }
  }

  declineApproval() {
    if (this.isApproving) return;
    this.showScaModal = false;
    this.approveAuthParam1 = '';
    this.scaStatus = '';
  }

  async confirmApproval() {
    if (!this.approveAuthParam1 || this.isApproving) return;

    this.isApproving = true;
    this.scaStatus = 'Waiting for your passkey...';
    this.cdr.detectChanges();

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.authenticate(this.approveAuthParam1);

      this.scaStatus = 'Approving the transfers...';
      this.cdr.detectChanges();

      this.transferService.finalizeApproval(this.userId, this.approvingIds, String(sdkOutput)).subscribe({
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
            this.toastError(httpErrorMessage(err, "Couldn't approve the transfers. Try again."));
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.ngZone.run(() => {
        this.isApproving = false;
        this.scaStatus = '';
        this.toastError(scaErrorMessage(e, 'Authentication failed. Try again.'));
        this.cdr.detectChanges();
      });
    }
  }

  private onApprovalComplete() {
    const approved = new Set(this.approvingIds);
    const transfers = this.pendingTransfers.filter(t => approved.has(t.id));
    this.approvalRecap = {
      count: transfers.length,
      total: this.getBatchTotal(transfers),
      transfers,
      date: formatDateTime(new Date())
    };
    approved.forEach(id => this.hiddenIds.add(id));
    this.pendingTransfers = this.pendingTransfers.filter(t => !approved.has(t.id));
    this.isApproving = false;
    this.scaStatus = '';
    this.showScaModal = false;
    this.approveAuthParam1 = '';
    this.approvingIds = [];
    this.transferService.invalidateTransactionCache(this.userId);
    this.fetchAccountInformation(true);
  }

  resetAll() {
    this.approvalRecap = null;
    this.resetForm();
    this.cdr.detectChanges();
  }

  private resetForm() {
    const currentCountry = this.transferForm.value.counterpartyCountry || '';
    this.transferForm.reset({
      amount: null,
      counterpartyName: '',
      counterpartyCountry: currentCountry,
      transferType: null,
      reference: '',
      description: ''
    });
    this.bank.restart();
  }

  private toastError(message: string) {
    this.snack.open(message, 'Close', { duration: 6000, panelClass: 'fintech-snack-error' });
  }
}
