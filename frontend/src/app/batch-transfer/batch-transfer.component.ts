import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';
import { AccountSetupStateComponent, LoadState, combineLoadStates, failedLoadState } from '../device/account-setup-state.component';
import { RemoteSessionPanelComponent } from '../remote-session/remote-session-panel.component';
import { ApprovalSwitchComponent } from '../remote-session/approval-switch.component';

import ScaWebauthn from '@adyen/bpscaweb';
import {
  BankAccountInformationResponse,
  BatchApproveResponse,
  BatchTransferRequest,
  BatchTransferResponse,
  PendingBatchTransfersResponse,
  RecipientCountry,
  RemoteSession,
  TestAccount,
  User,
  VerifyCounterpartyNameRequest
} from '../models';
import { AccountService, RemoteSessionService, TransferService } from '../services';
import {
  ApprovalChoice, ApprovalMode, ConfirmService, InlineAlertComponent, MoneyPipe, NotifyService, approvalChoice, formatMoney,
  httpErrorMessage, saveApprovalMode, scaErrorMessage, toMinorUnits
} from '../shared';
import { RecipientCountryPickerComponent } from '../recipient-country-picker/recipient-country-picker.component';
import { TransferSpeedPickerComponent } from '../transfer-speed-picker/transfer-speed-picker.component';
import { BankDetailsCheck, speedBlockReason } from '../banktransfer/bank-details';
import { BankDetailsFieldsComponent } from '../banktransfer/bank-details-fields.component';
import { formatDateTime } from '../banktransfer/format-date';

type PageState = LoadState | 'no-device';

/** A failed step, shown next to the action that failed, with the action that tries it again. */
interface FlowError {
  title: string;
  message: string;
  retry: () => void;
  actionLabel?: string;
}

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
    InlineAlertComponent,
    DeviceRegistrationComponent,
    AccountSetupStateComponent,
    RecipientCountryPickerComponent,
    TransferSpeedPickerComponent,
    BankDetailsFieldsComponent,
    RemoteSessionPanelComponent,
    ApprovalSwitchComponent
  ],
  templateUrl: './batch-transfer.component.html',
  styleUrl: './batch-transfer.component.css'
})
export class BatchTransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private remoteSessions = inject(RemoteSessionService);
  private confirmService = inject(ConfirmService);
  private notify = inject(NotifyService);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user: User | null = null;
  accountInfo?: BankAccountInformationResponse;

  accountState: LoadState = 'loading';
  devicesState: LoadState = 'loading';
  hasDevices = false;
  /** With the passkey of this browser, or on a phone from a QR code. */
  approval: ApprovalChoice = { mode: 'here', canSwitch: false };
  loadErrorMessage = '';

  recipientCountries: RecipientCountry[] = [];
  countriesError = '';

  // VoP: an exact match is shown next to the name field, other results ask for a decision.
  showPartialMatchModal = false;
  showNoMatchModal = false;
  suggestedName = '';
  // Payee details the bank confirmed, so an edit of any of them hides "Name matches" again.
  private matchedPayee = '';

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
  addError: FlowError | null = null;
  isLoadingPending = false;
  pendingError = '';
  pendingTransfers: BatchTransferResponse[] = [];
  pendingNotFoundCount = 0;
  cancellingIds = new Set<string>();
  pendingActionError: FlowError | null = null;
  // Cancelled or approved transfers can still be listed as pending for a while: never show them again.
  private hiddenIds = new Set<string>();

  isApproving = false;
  approvalError: FlowError | null = null;
  approvalRecap: ApprovalRecap | null = null;
  showScaModal = false;
  scaStatus = '';
  batchRemoteStart: (() => Observable<RemoteSession>) | null = null;
  private approveAuthParam1 = '';
  private approvingIds: string[] = [];

  constructor() {
    this.transferForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.addError = null);
  }

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
        this.countriesError = httpErrorMessage(err, "The recipient countries couldn't be loaded. Try again.");
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
          this.loadErrorMessage = httpErrorMessage(err, "Unable to load your account. Try again.");
        }
        this.cdr.detectChanges();
      }
    });
  }

  /** A refresh after a registration keeps the page as it is if it fails. */
  checkDevices(refresh = false) {
    if (!refresh) this.devicesState = 'loading';
    this.transferService.listDevices(this.userId).subscribe({
      next: async (devices) => {
        this.approval = await approvalChoice(devices, this.userId);
        this.hasDevices = !!devices && devices.length > 0;
        this.devicesState = 'ready';
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (!refresh) {
          this.devicesState = failedLoadState(err);
          this.loadErrorMessage = httpErrorMessage(err, "Unable to load your trusted devices. Try again.");
        }
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
        this.pendingError = httpErrorMessage(err, "The transfers waiting for approval couldn't be loaded. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices = true;
    this.notify.success('Device registered. You can now make batch transfers.');
    this.checkDevices(true);
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

  private verifyPayload(): VerifyCounterpartyNameRequest {
    const bank = this.bank.normalized();
    return {
      accountHolderName: this.transferForm.value.counterpartyName || '',
      iban: bank.iban,
      reference: this.transferForm.value.reference || '',
      accountNumber: bank.accountNumber,
      sortCode: bank.sortCode,
      accountType: this.bank.format || '',
      transferType: this.transferForm.value.transferType || '',
      counterpartyCountry: this.transferForm.value.counterpartyCountry || ''
    };
  }

  /** The bank confirmed the beneficiary name for the details currently in the form. */
  get nameMatches(): boolean {
    return !!this.matchedPayee && this.matchedPayee === JSON.stringify(this.verifyPayload());
  }

  submitTransfer() {
    if (this.blockReason || this.isAdding) return;
    this.addError = null;

    const country = this.transferForm.value.counterpartyCountry;

    if (!this.findRecipientCountry(country)?.payeeVerification || this.nameMatches) {
      this.addToBatch();
      return;
    }

    this.isAdding = true;
    this.cdr.detectChanges();

    const verifyPayload = this.verifyPayload();
    const payeeKey = JSON.stringify(verifyPayload);

    this.transferService.verifyCounterpartyName(verifyPayload).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.isAdding = false;

          if (res.response === 'nameMatch') {
            this.matchedPayee = payeeKey;
            this.addToBatch();
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
          this.addError = {
            title: 'Unable to check the beneficiary name',
            message: httpErrorMessage(err, "The beneficiary name couldn't be checked with their bank. Try again."),
            retry: () => this.submitTransfer()
          };
          this.cdr.detectChanges();
        });
      }
    });
  }

  acceptSuggestedName() {
    this.showPartialMatchModal = false;
    this.transferForm.patchValue({ counterpartyName: this.suggestedName });
    this.matchedPayee = JSON.stringify(this.verifyPayload());
    this.addToBatch();
  }

  proceedWithRisk() {
    this.showNoMatchModal = false;
    this.addToBatch();
  }

  modifyInfo() {
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
          this.notify.success(
            `${formatMoney(res.amount ?? request.amount, res.currency || this.userCurrency)} to ${res.counterpartyName || request.counterpartyName} added to the batch`
          );
          this.resetForm();
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.isAdding = false;
          this.addError = {
            title: 'Unable to add the transfer to the batch',
            message: httpErrorMessage(err, "The transfer couldn't be added to the batch. Try again."),
            retry: () => this.submitTransfer()
          };
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
    if (confirmed) this.ngZone.run(() => this.cancelTransfers([transfer]));
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
    if (confirmed) this.ngZone.run(() => this.cancelTransfers(transfers));
  }

  retryAddTransfer() {
    const error = this.addError;
    this.addError = null;
    error?.retry();
  }

  retryPendingAction() {
    const error = this.pendingActionError;
    this.pendingActionError = null;
    error?.retry();
  }

  retryApproval() {
    const error = this.approvalError;
    this.approvalError = null;
    error?.retry();
  }

  private cancelTransfers(transfers: BatchTransferResponse[]) {
    const ids = transfers.map(t => t.id);
    ids.forEach(id => this.cancellingIds.add(id));
    this.pendingActionError = null;
    this.cdr.detectChanges();

    this.transferService.cancelBatchTransfers(this.userId, ids).subscribe({
      next: (res) => {
        const cancelled = new Set(res?.transferIds?.length ? res.transferIds : ids);
        cancelled.forEach(id => this.hiddenIds.add(id));
        ids.forEach(id => this.cancellingIds.delete(id));
        this.pendingTransfers = this.pendingTransfers.filter(t => !cancelled.has(t.id));
        const notCancelled = ids.filter(id => !cancelled.has(id)).length;
        if (notCancelled > 0) {
          this.pendingActionError = {
            title: notCancelled === 1 ? "1 transfer couldn't be cancelled" : `${notCancelled} transfers couldn't be cancelled`,
            message: 'They may already have been processed. Refresh the list to see their current state.',
            retry: () => this.loadPendingTransfers(),
            actionLabel: 'Refresh'
          };
        } else {
          this.notify.success(cancelled.size === 1 ? 'Transfer cancelled' : `${cancelled.size} transfers cancelled`);
        }
        this.loadPendingTransfers();
      },
      error: (err) => {
        ids.forEach(id => this.cancellingIds.delete(id));
        this.pendingActionError = {
          title: ids.length === 1 ? 'Unable to cancel the transfer' : 'Unable to cancel the transfers',
          message: httpErrorMessage(err, "The transfers couldn't be cancelled. Try again."),
          retry: () => this.cancelTransfers(transfers.filter(t => this.pendingTransfers.some(p => p.id === t.id)))
        };
        this.cdr.detectChanges();
      }
    });
  }

  get isCancelling(): boolean {
    return this.cancellingIds.size > 0;
  }

  // ─────────── Approval ───────────

  /** Nothing is sent and no approval is created on a phone before the person confirms this recap. */
  async approveAll() {
    if (this.pendingTransfers.length === 0 || this.isApproving) return;
    const transfers = [...this.pendingTransfers];
    const total = this.getBatchTotal(transfers);
    const confirmed = await this.confirmService.confirm({
      title: transfers.length === 1
        ? `Send ${total} to ${transfers[0].counterpartyName || 'this beneficiary'}?`
        : `Send ${transfers.length} transfers for ${total}?`,
      details: [
        ...transfers.map(t => ({ label: t.counterpartyName || 'Beneficiary', value: formatMoney(t.amount, t.currency || this.userCurrency) })),
        { label: 'Total', value: total }
      ],
      confirmText: `Send ${total}`,
      cancelText: 'Cancel'
    });
    if (!confirmed) return;

    this.ngZone.run(() => {
      this.approvalError = null;
      this.approvingIds = transfers.map(t => t.id);
      if (this.approval.mode === 'phone') {
        this.openBatchOnPhone();
      } else {
        this.prepareBatchHere();
      }
      this.cdr.detectChanges();
    });
  }

  private openBatchOnPhone() {
    const transferIds = this.approvingIds;
    this.approveAuthParam1 = '';
    this.scaStatus = '';
    this.batchRemoteStart = () => this.remoteSessions.createApproval({ userId: this.userId, type: 'batch', transferIds });
    this.showScaModal = true;
    this.cdr.detectChanges();
  }

  /** Gets the challenge of the batch for the passkey of this browser. */
  private async prepareBatchHere() {
    this.isApproving = true;
    this.approveAuthParam1 = '';
    this.scaStatus = 'Checking passkey availability…';
    this.cdr.detectChanges();

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.checkAvailability();

      this.scaStatus = 'Preparing the approval…';
      this.cdr.detectChanges();

      this.transferService.approveTransfers(this.userId, this.approvingIds, String(sdkOutput)).subscribe({
        next: (res: BatchApproveResponse) => {
          this.ngZone.run(() => {
            if (res.status === 'transfers_not_ready') {
              this.failBatchStart(res.message || 'Some transfers are still being created. Wait about a minute and try again.');
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
        error: (err) => this.failBatchStart(httpErrorMessage(err, "The approval couldn't be started. Try again."))
      });
    } catch (e) {
      this.failBatchStart(scaErrorMessage(e, "The authentication couldn't be started. Try again."));
    }
  }

  /** The modal is already open when the user switched to this browser. */
  private failBatchStart(message: string) {
    this.ngZone.run(() => {
      this.isApproving = false;
      this.scaStatus = '';
      this.showScaModal = false;
      this.approvalError = { title: 'Unable to start the approval', message, retry: () => this.approveAll() };
      this.cdr.detectChanges();
    });
  }

  /** Removing the QR code cancels its session, so the phone can no longer approve the batch. */
  switchApproval(mode: ApprovalMode) {
    if (this.isApproving) return;
    this.approval = { ...this.approval, mode };
    saveApprovalMode(this.userId, mode);
    if (mode === 'phone') {
      this.openBatchOnPhone();
    } else {
      this.batchRemoteStart = null;
      this.prepareBatchHere();
    }
  }

  declineApproval() {
    if (this.isApproving) return;
    this.showScaModal = false;
    this.batchRemoteStart = null;
    this.approveAuthParam1 = '';
    this.scaStatus = '';
    this.approvalError = null;
  }

  onBatchApprovedOnPhone() {
    this.onApprovalComplete();
    this.cdr.detectChanges();
  }

  async confirmApproval() {
    if (!this.approveAuthParam1 || this.isApproving) return;

    this.isApproving = true;
    this.approvalError = null;
    this.scaStatus = 'Waiting for your passkey…';
    this.cdr.detectChanges();
    const fail = (message: string) => {
      this.isApproving = false;
      this.scaStatus = '';
      this.approvalError = { title: 'Unable to send the transfers', message, retry: () => this.confirmApproval() };
      this.cdr.detectChanges();
    };

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.authenticate(this.approveAuthParam1);

      this.scaStatus = 'Sending the transfers…';
      this.cdr.detectChanges();

      this.transferService.finalizeApproval(this.userId, this.approvingIds, String(sdkOutput)).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showScaModal = false;
            this.onApprovalComplete();
            this.cdr.detectChanges();
          });
        },
        error: (err) => this.ngZone.run(() => fail(httpErrorMessage(err, "The transfers couldn't be approved. Try again.")))
      });
    } catch (e) {
      this.ngZone.run(() => fail(scaErrorMessage(e, 'Authentication failed. Try again.')));
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
    this.approvalError = null;
    this.scaStatus = '';
    this.showScaModal = false;
    this.batchRemoteStart = null;
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

}
