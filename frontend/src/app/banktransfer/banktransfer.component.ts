import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';
import { AccountSetupStateComponent, LoadState, combineLoadStates, failedLoadState } from '../device/account-setup-state.component';
import { RemoteSessionPanelComponent } from '../remote-session/remote-session-panel.component';
import { ApprovalSwitchComponent } from '../remote-session/approval-switch.component';

import ScaWebauthn from '@adyen/bpscaweb';
import { Observable } from 'rxjs';
import {
  BankAccountInformationResponse,
  InitiateTransferRequest,
  RecipientCountry,
  RemoteSession,
  VerifyCounterpartyNameRequest,
  StandingOrder,
  StandingOrderCreateRequest,
  StandingOrderInitiateResponse,
  TestAccount,
  TransferRouteRequest,
  User
} from '../models';
import { AccountService, RemoteSessionService, TransferService, StandingOrderService } from '../services';
import {
  ApprovalChoice, ApprovalMode, ConfirmService, MoneyPipe, approvalChoice, formatMoney, fromMinorUnits, httpErrorMessage,
  saveApprovalMode, scaErrorMessage, toMinorUnits
} from '../shared';
import { RecipientCountryPickerComponent } from '../recipient-country-picker/recipient-country-picker.component';
import { TransferSpeedPickerComponent } from '../transfer-speed-picker/transfer-speed-picker.component';
import { BankDetailsCheck, DetailRow, bankDetailRows, bankDetailsSummary, speedBlockReason } from './bank-details';
import { BankDetailsFieldsComponent } from './bank-details-fields.component';
import { countryName, formatDateTime, speedLabel } from './format-date';
import { STANDING_ORDER_SCHEDULES, describeSchedule } from './schedule-label';

type PageState = LoadState | 'no-device';

export interface TransferRecap {
  amount: number;
  currency: string;
  beneficiary: string;
  country: string;
  accountRows: DetailRow[];
  speed: string;
  reference: string;
  description: string;
  date: string;
}

@Component({
  selector: 'app-banktransfer',
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
    BankDetailsFieldsComponent,
    RemoteSessionPanelComponent,
    ApprovalSwitchComponent
  ],
  templateUrl: './banktransfer.component.html',
  styleUrl: './banktransfer.component.css'
})
export class BankTransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private soService = inject(StandingOrderService);
  private remoteSessions = inject(RemoteSessionService);
  private confirmService = inject(ConfirmService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user: User | null = null;
  accountInfo?: BankAccountInformationResponse;

  // ─── Page state ───
  accountState: LoadState = 'loading';
  devicesState: LoadState = 'loading';
  hasDevices = false;
  /** With the passkey of this browser, or on a phone from a QR code. */
  approval: ApprovalChoice = { mode: 'here', canSwitch: false };
  loadErrorMessage = '';

  // ─── Tab management ───
  activeTab: 'oneshot' | 'standing' = 'oneshot';

  // ─── Recipient countries reachable from the account currency ───
  recipientCountries: RecipientCountry[] = [];
  countriesError = '';

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
    transferType: [null as string | null, [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    reference: [''],
    description: [''],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: ['']
  });
  readonly oneshotBank = new BankDetailsCheck(this.oneshotForm, this.transferService, () => this.cdr.detectChanges());

  isOneshotProcessing = false;
  showOneshotScaModal = false;
  /** Creates the approval of the transfer on the phone. */
  oneshotRemoteStart: (() => Observable<RemoteSession>) | null = null;
  private oneshotAuthParam = '';
  // Recap of the transfer being approved, then of the completed one.
  oneshotDraft: TransferRecap | null = null;
  oneshotRecap: TransferRecap | null = null;

  // ─── Standing orders state ───
  standingOrders: StandingOrder[] = [];
  soLoading = true;
  soError = '';
  soView: 'list' | 'create' | 'edit' = 'list';
  deletingSoId: string | null = null;

  createForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    counterpartyName: ['', [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: [''],
    schedule: ['daily', [Validators.required]],
    priority: [null as string | null, [Validators.required]],
    reference: [''],
    description: [''],
    referenceForBeneficiary: ['']
  });
  readonly standingBank = new BankDetailsCheck(this.createForm, this.transferService, () => this.cdr.detectChanges());

  isCreating = false;
  scaStatus = '';

  editingOrder: StandingOrder | null = null;
  editRouteBeneficiary: TransferRouteRequest | null = null;
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
  /** Creates the approval of the scheduled transfer on the phone. */
  soRemoteStart: (() => Observable<RemoteSession>) | null = null;

  // ─────────── Lifecycle ───────────

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
        this.loadRecipientCountries();
        this.fetchAccountInformation();
        this.checkDevices();
        this.loadStandingOrders();
      }
    });
  }

  ngOnDestroy() {
    this.oneshotBank.destroy();
    this.standingBank.destroy();
  }

  // ─────────── Page state ───────────

  get pageState(): PageState {
    const state = combineLoadStates(this.accountState, this.devicesState);
    return state === 'ready' && !this.hasDevices ? 'no-device' : state;
  }

  /** Loading, missing and error states of the page; 'ready' once the account and the devices are known. */
  get setupState(): LoadState {
    const state = this.pageState;
    return state === 'no-device' ? 'ready' : state;
  }

  retryPage() {
    if (this.accountState !== 'ready') this.fetchAccountInformation();
    if (this.devicesState !== 'ready') this.checkDevices();
    if (!this.recipientCountries.length) this.loadRecipientCountries();
  }

  onTabChange(index: number) {
    this.activeTab = index === 0 ? 'oneshot' : 'standing';
  }

  // ─────────── Shared data loading ───────────

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

  /** A refresh after a transfer keeps the page as it is if it fails. */
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
          this.loadErrorMessage = httpErrorMessage(err, "Couldn't load your trusted devices. Try again.");
        }
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices = true;
    this.snack.open('Device registered. You can now make transfers.', 'Close', { duration: 4000, panelClass: 'fintech-snack-success' });
    this.checkDevices(true);
    this.cdr.detectChanges();
  }

  get userCurrency(): string {
    return this.accountInfo?.currency || this.user?.currencyCode || 'EUR';
  }

  // ─────────── Shared bank details ───────────

  onCountryChange(context: 'oneshot' | 'standing', countryCode: string) {
    const check = context === 'oneshot' ? this.oneshotBank : this.standingBank;
    check.setFormat(this.findRecipientCountry(countryCode)?.bankAccountFormat ?? null);
  }

  testAccountOf(context: 'oneshot' | 'standing'): TestAccount | null {
    const form = context === 'oneshot' ? this.oneshotForm : this.createForm;
    return this.findRecipientCountry(form.value.counterpartyCountry)?.testAccount ?? null;
  }

  private findRecipientCountry(countryCode: string | null | undefined): RecipientCountry | undefined {
    return this.recipientCountries.find(country => country.countryCode === countryCode);
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

  private verifyPayloadOf(context: 'oneshot' | 'standing'): VerifyCounterpartyNameRequest {
    const isOneshot = context === 'oneshot';
    const check = isOneshot ? this.oneshotBank : this.standingBank;
    const values = isOneshot ? this.oneshotForm.value : this.createForm.value;
    const bank = check.normalized();
    return {
      accountHolderName: (isOneshot ? this.oneshotForm.value.accountHolderName : this.createForm.value.counterpartyName) || '',
      iban: bank.iban,
      reference: values.reference || '',
      accountNumber: bank.accountNumber,
      sortCode: bank.sortCode,
      accountType: check.format || '',
      transferType: (isOneshot ? this.oneshotForm.value.transferType : this.createForm.value.priority) || 'regular',
      counterpartyCountry: values.counterpartyCountry || ''
    };
  }

  /** Verification of payee, then the matching modal or the next step directly. */
  private verifyPayee(context: 'oneshot' | 'standing', next: () => void, setBusy: (busy: boolean) => void) {
    this.vopContext = context;
    const country = context === 'oneshot' ? this.oneshotForm.value.counterpartyCountry : this.createForm.value.counterpartyCountry;
    if (!this.findRecipientCountry(country)?.payeeVerification) {
      next();
      return;
    }

    setBusy(true);
    this.transferService.verifyCounterpartyName(this.verifyPayloadOf(context)).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          setBusy(false);
          if (res.response === 'nameMatch') {
            this.showExactMatchModal = true;
          } else if (res.response === 'partialNameMatch') {
            this.suggestedName = res.name;
            this.showPartialMatchModal = true;
          } else if (res.response === 'noNameMatch') {
            this.showNoMatchModal = true;
          } else {
            next();
          }
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          setBusy(false);
          this.toastError(httpErrorMessage(err, "Couldn't verify the beneficiary name. Try again."));
          this.cdr.detectChanges();
        });
      }
    });
  }

  // ═══════════════════════════════════════════
  //  ONE-SHOT TRANSFER
  // ═══════════════════════════════════════════

  get oneshotAmountMinor(): number | null {
    const amount = this.oneshotForm.value.amount;
    return typeof amount === 'number' && Number.isFinite(amount) ? toMinorUnits(amount, this.userCurrency) : null;
  }

  get oneshotExceedsBalance(): boolean {
    const amount = this.oneshotAmountMinor;
    return !!this.accountInfo && amount !== null && this.accountInfo.currency === this.userCurrency && amount > this.accountInfo.amount;
  }

  get oneshotBlockReason(): string {
    const controls = this.oneshotForm.controls;
    if (controls.amount.invalid) return 'Enter an amount to continue.';
    if (this.oneshotExceedsBalance) return 'The amount is higher than your available balance.';
    if (controls.accountHolderName.invalid) return 'Enter the beneficiary name to continue.';
    if (controls.counterpartyCountry.invalid) return 'Choose the recipient country to continue.';
    return this.oneshotBank.blockReason || speedBlockReason(controls.transferType);
  }

  amountError(control: 'oneshot' | 'standing'): string {
    const amount = control === 'oneshot' ? this.oneshotForm.controls.amount : this.createForm.controls.amount;
    if (amount.errors?.['min'] && (amount.touched || amount.dirty)) {
      return `Enter an amount of at least ${formatMoney(1, this.userCurrency)}.`;
    }
    return '';
  }

  private buildTransferRequest(sdkOutput: string): InitiateTransferRequest {
    const formVals = this.oneshotForm.value;
    const bank = this.oneshotBank.normalized();

    return {
      sdkOutput: String(sdkOutput),
      amount: this.oneshotAmountMinor ?? 0,
      reference: formVals.reference || '',
      description: formVals.description || '',
      userId: this.userId,
      transferType: formVals.transferType!,
      counterpartyCountry: formVals.counterpartyCountry!,
      ...bank,
      counterpartyName: formVals.accountHolderName || ''
    };
  }

  private buildOneshotRecap(): TransferRecap {
    const formVals = this.oneshotForm.value;
    return {
      amount: this.oneshotAmountMinor ?? 0,
      currency: this.userCurrency,
      beneficiary: formVals.accountHolderName || '',
      country: countryName(formVals.counterpartyCountry),
      accountRows: bankDetailRows(this.oneshotBank.normalized()),
      speed: speedLabel(formVals.transferType),
      reference: formVals.reference || '',
      description: formVals.description || '',
      date: formatDateTime(new Date())
    };
  }

  submitOneshot() {
    if (this.oneshotBlockReason || this.isOneshotProcessing) return;
    this.verifyPayee('oneshot', () => this.initiateTransferFlow(), busy => this.isOneshotProcessing = busy);
  }

  initiateTransferFlow() {
    if (this.approval.mode === 'phone') {
      this.openOneshotOnPhone();
    } else {
      this.prepareOneshotHere();
    }
  }

  /** Gets the challenge of the transfer for the passkey of this browser. */
  private async prepareOneshotHere() {
    this.isOneshotProcessing = true;
    this.cdr.detectChanges();
    const draft = this.buildOneshotRecap();
    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.checkAvailability();
      const request = this.buildTransferRequest(String(sdkOutput));

      this.transferService.initiateTransfer(request).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            this.isOneshotProcessing = false;
            if (!res.authParam1) {
              this.showOneshotScaModal = false;
              this.completeOneshot(draft);
            } else {
              this.oneshotAuthParam = res.authParam1;
              this.oneshotDraft = draft;
              this.showOneshotScaModal = true;
            }
            this.cdr.detectChanges();
          });
        },
        error: (err) => this.failOneshotStart(httpErrorMessage(err, "Couldn't start the transfer. Try again."))
      });
    } catch (e) {
      this.failOneshotStart(scaErrorMessage(e, "Couldn't start the authentication. Try again."));
    }
  }

  /** Back to the form, which kept its values. The modal is already open when the user switched to this browser. */
  private failOneshotStart(message: string) {
    this.ngZone.run(() => {
      this.isOneshotProcessing = false;
      this.showOneshotScaModal = false;
      this.toastError(message);
      this.cdr.detectChanges();
    });
  }

  /** The phone gets its own challenge: the transfer is only sent to Adyen once it opened the link. */
  private openOneshotOnPhone() {
    const transfer = this.buildTransferRequest('');
    this.oneshotAuthParam = '';
    this.oneshotDraft = this.buildOneshotRecap();
    this.oneshotRemoteStart = () => this.remoteSessions.createApproval({ userId: this.userId, type: 'transfer', transfer });
    this.showOneshotScaModal = true;
    this.cdr.detectChanges();
  }

  /** Removing the QR code cancels its session, so the phone can no longer send the transfer. */
  switchOneshotApproval(mode: ApprovalMode) {
    if (this.isOneshotProcessing) return;
    this.chooseApproval(mode);
    if (mode === 'phone') {
      this.openOneshotOnPhone();
    } else {
      this.oneshotRemoteStart = null;
      this.prepareOneshotHere();
    }
  }

  onOneshotApprovedOnPhone() {
    const draft = this.oneshotDraft;
    this.showOneshotScaModal = false;
    this.oneshotRemoteStart = null;
    if (draft) this.completeOneshot(draft);
    this.cdr.detectChanges();
  }

  declineOneshot() {
    if (this.isOneshotProcessing) return;
    this.showOneshotScaModal = false;
    this.oneshotRemoteStart = null;
    this.oneshotAuthParam = '';
  }

  async approveOneshot() {
    if (!this.oneshotAuthParam || !this.oneshotDraft) return;
    this.isOneshotProcessing = true;
    const draft = this.oneshotDraft;

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.authenticate(this.oneshotAuthParam);
      const request = this.buildTransferRequest(String(sdkOutput));

      this.transferService.finalizeTransfer(request).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showOneshotScaModal = false;
            this.isOneshotProcessing = false;
            this.completeOneshot(draft);
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isOneshotProcessing = false;
            this.toastError(httpErrorMessage(err, "Couldn't complete the transfer. Try again."));
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.ngZone.run(() => {
        this.isOneshotProcessing = false;
        this.toastError(scaErrorMessage(e, 'Authentication failed. Try again.'));
        this.cdr.detectChanges();
      });
    }
  }

  private completeOneshot(recap: TransferRecap) {
    this.oneshotRecap = { ...recap, date: formatDateTime(new Date()) };
    this.oneshotDraft = null;
    this.oneshotAuthParam = '';
    this.transferService.invalidateTransactionCache(this.userId);
    this.fetchAccountInformation(true);
  }

  resetOneshotForm() {
    this.oneshotRecap = null;
    this.oneshotDraft = null;
    this.oneshotBank.setFormat(null);
    this.oneshotForm.reset({
      amount: null,
      transferType: null,
      counterpartyCountry: '',
      accountHolderName: '',
      reference: '',
      description: ''
    });
    this.cdr.detectChanges();
  }

  // ═══════════════════════════════════════════
  //  STANDING ORDERS
  // ═══════════════════════════════════════════

  loadStandingOrders() {
    this.soLoading = true;
    this.soError = '';
    this.soService.list(this.userId).subscribe({
      next: (data) => {
        this.standingOrders = data.standingOrders || [];
        this.soLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.soError = httpErrorMessage(err, "Couldn't load your scheduled transfers. Try again.");
        this.standingOrders = [];
        this.soLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  get createBlockReason(): string {
    const controls = this.createForm.controls;
    if (controls.amount.invalid) return 'Enter an amount to continue.';
    if (controls.counterpartyName.invalid) return 'Enter the beneficiary name to continue.';
    if (controls.counterpartyCountry.invalid) return 'Choose the recipient country to continue.';
    if (controls.schedule.invalid) return 'Choose a schedule to continue.';
    return this.standingBank.blockReason || speedBlockReason(controls.priority);
  }

  showSoCreate() {
    this.soView = 'create';
    this.scaStatus = '';
    this.standingBank.setFormat(null);
    this.createForm.reset({
      amount: null,
      counterpartyName: '',
      counterpartyCountry: '',
      schedule: 'daily',
      priority: null,
      reference: '',
      description: '',
      referenceForBeneficiary: ''
    });
  }

  showSoList() {
    this.soView = 'list';
    this.editingOrder = null;
    this.editRouteBeneficiary = null;
    this.scaStatus = '';
    this.standingBank.setFormat(null);
    this.loadStandingOrders();
  }

  showSoEdit(order: StandingOrder) {
    this.editingOrder = order;
    this.editRouteBeneficiary = this.routeBeneficiaryOf(order);
    this.soView = 'edit';
    this.editForm.reset({
      reference: order.reference || '',
      description: order.description || '',
      referenceForBeneficiary: order.referenceForBeneficiary || '',
      priority: order.priorities?.[0] || 'regular'
    });
  }

  private routeBeneficiaryOf(order: StandingOrder): TransferRouteRequest | null {
    const account = this.soAccount(order);
    const countryByType: Record<string, string> = {
      iban: (account?.iban || '').slice(0, 2).toUpperCase(),
      ukLocal: 'GB',
      usLocal: 'US'
    };
    const counterpartyCountry = account ? countryByType[account.type] : '';
    if (!counterpartyCountry) return null;

    return {
      counterpartyCountry,
      iban: account?.iban || '',
      accountNumber: account?.accountNumber || '',
      routingNumber: account?.routingNumber || '',
      sortCode: account?.sortCode || ''
    };
  }

  soAccount(order: StandingOrder) {
    return order.counterparty?.bankAccount?.accountIdentification ?? null;
  }

  soBeneficiary(order: StandingOrder): string {
    return order.counterparty?.bankAccount?.accountHolder?.fullName || 'Unknown beneficiary';
  }

  soAccountSummary(order: StandingOrder): string {
    return bankDetailsSummary(this.soAccount(order) ?? {});
  }

  soAccountRows(order: StandingOrder): DetailRow[] {
    return bankDetailRows(this.soAccount(order) ?? {});
  }

  soAmountValue(order: StandingOrder): number {
    return order.amount?.value ?? 0;
  }

  soCurrency(order: StandingOrder): string {
    return order.amount?.currency || this.userCurrency;
  }

  soAmountMajor(order: StandingOrder): number {
    return fromMinorUnits(this.soAmountValue(order), this.soCurrency(order));
  }

  getScheduleLabel(schedule: unknown): string {
    return describeSchedule(schedule, STANDING_ORDER_SCHEDULES);
  }

  soStatusLabel(order: StandingOrder): string {
    return order.status === 'active' ? 'Active' : 'Inactive';
  }

  async onDeleteSo(order: StandingOrder) {
    if (this.deletingSoId) return;
    const confirmed = await this.confirmService.confirm({
      title: 'Delete this scheduled transfer?',
      message: 'No further transfers will be sent on this schedule. Transfers already sent are not affected.',
      details: [
        { label: 'Beneficiary', value: this.soBeneficiary(order) },
        { label: 'Amount', value: formatMoney(this.soAmountValue(order), this.soCurrency(order)) },
        { label: 'Schedule', value: this.getScheduleLabel(order.schedule) }
      ],
      confirmText: 'Delete scheduled transfer',
      danger: true
    });
    if (!confirmed) return;

    this.deletingSoId = order.id;
    this.cdr.detectChanges();
    this.soService.delete(this.userId, order.id).subscribe({
      next: () => {
        this.deletingSoId = null;
        this.snack.open('Scheduled transfer deleted', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
        this.loadStandingOrders();
      },
      error: (err) => {
        this.deletingSoId = null;
        this.toastError(httpErrorMessage(err, "Couldn't delete the scheduled transfer. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  onSaveEdit() {
    if (!this.editingOrder || this.isSaving || this.editForm.invalid) return;
    this.isSaving = true;

    const patch = {
      reference: this.editForm.value.reference || '',
      description: this.editForm.value.description || '',
      referenceForBeneficiary: this.editForm.value.referenceForBeneficiary || '',
      priorities: [this.editForm.value.priority || 'regular']
    };

    this.soService.update(this.userId, this.editingOrder.id, patch).subscribe({
      next: (updated) => {
        this.editingOrder = updated;
        this.isSaving = false;
        this.editForm.markAsPristine();
        this.snack.open('Scheduled transfer updated', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSaving = false;
        this.toastError(httpErrorMessage(err, "Couldn't update the scheduled transfer. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  private buildCreatePayload(): StandingOrderCreateRequest {
    const f = this.createForm.value;
    const bank = this.standingBank.normalized();

    let accountIdentification: StandingOrderCreateRequest['counterparty']['bankAccount']['accountIdentification'];
    if (this.standingBank.format === 'accountNumberRoutingNumber') {
      accountIdentification = { type: 'usLocal', accountNumber: bank.accountNumber, routingNumber: bank.routingNumber };
    } else if (this.standingBank.format === 'accountNumberSortCode') {
      accountIdentification = { type: 'ukLocal', accountNumber: bank.accountNumber, sortCode: bank.sortCode };
    } else {
      accountIdentification = { type: 'iban', iban: bank.iban };
    }

    return {
      amount: {
        currency: this.userCurrency,
        value: toMinorUnits(f.amount || 0, this.userCurrency)
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

  onCreateSo() {
    if (this.createBlockReason || this.isCreating) return;
    this.verifyPayee('standing', () => this.initiateStandingOrderFlow(), busy => this.isCreating = busy);
  }

  initiateStandingOrderFlow() {
    this.pendingStandingOrder = this.buildCreatePayload();
    if (this.approval.mode === 'phone') {
      this.openSoOnPhone(this.pendingStandingOrder);
    } else {
      this.prepareSoHere(this.pendingStandingOrder);
    }
  }

  private openSoOnPhone(standingOrder: StandingOrderCreateRequest) {
    this.scaStatus = '';
    this.scaInitiateResult = null;
    this.soRemoteStart = () => this.remoteSessions.createApproval({ userId: this.userId, type: 'standingOrder', standingOrder });
    this.showSoScaModal = true;
    this.cdr.detectChanges();
  }

  /** Gets the challenge of the scheduled transfer for the passkey of this browser. */
  private async prepareSoHere(standingOrder: StandingOrderCreateRequest) {
    this.isCreating = true;
    this.scaInitiateResult = null;

    try {
      this.scaStatus = 'Checking passkey availability...';
      this.cdr.detectChanges();
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutputInit = await scaWebauthn.checkAvailability();

      this.scaStatus = 'Creating the scheduled transfer...';
      this.cdr.detectChanges();

      this.soService.initiate(this.userId, standingOrder, String(sdkOutputInit)).subscribe({
        next: (result) => {
          this.ngZone.run(() => {
            if (result.status === 'completed') {
              this.scaStatus = '';
              this.isCreating = false;
              this.showSoScaModal = false;
              this.onStandingOrderCreated(standingOrder);
            } else if (result.status === 'sca_required') {
              this.scaInitiateResult = result;
              this.scaStatus = '';
              this.showSoScaModal = true;
              this.isCreating = false;
            } else {
              this.failSoStart("Couldn't create the scheduled transfer: unexpected response. Try again.");
            }
            this.cdr.detectChanges();
          });
        },
        error: (err) => this.failSoStart(httpErrorMessage(err, "Couldn't create the scheduled transfer. Try again."))
      });
    } catch (e) {
      this.failSoStart(scaErrorMessage(e, "Couldn't start the authentication. Try again."));
    }
  }

  /** Back to the form, which kept its values. The modal is already open when the user switched to this browser. */
  private failSoStart(message: string) {
    this.ngZone.run(() => {
      this.isCreating = false;
      this.scaStatus = '';
      this.showSoScaModal = false;
      this.toastError(message);
      this.cdr.detectChanges();
    });
  }

  /** Removing the QR code cancels its session, so the phone can no longer create the scheduled transfer. */
  switchSoApproval(mode: ApprovalMode) {
    const standingOrder = this.pendingStandingOrder;
    if (this.isCreating || !standingOrder) return;
    this.chooseApproval(mode);
    if (mode === 'phone') {
      this.openSoOnPhone(standingOrder);
    } else {
      this.soRemoteStart = null;
      this.prepareSoHere(standingOrder);
    }
  }

  async approveSoScaChallenge() {
    if (!this.scaInitiateResult?.authParam1 || !this.pendingStandingOrder) return;
    this.isCreating = true;
    const standingOrder = this.pendingStandingOrder;

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      this.scaStatus = 'Waiting for your passkey...';
      this.cdr.detectChanges();

      const sdkOutput = await scaWebauthn.authenticate(this.scaInitiateResult.authParam1);

      this.scaStatus = 'Creating the scheduled transfer...';
      this.cdr.detectChanges();

      this.soService.finalize(this.userId, standingOrder, String(sdkOutput)).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showSoScaModal = false;
            this.isCreating = false;
            this.scaStatus = '';
            this.onStandingOrderCreated(standingOrder);
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isCreating = false;
            this.scaStatus = '';
            this.toastError(httpErrorMessage(err, "Couldn't create the scheduled transfer. Try again."));
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.ngZone.run(() => {
        this.isCreating = false;
        this.scaStatus = '';
        this.toastError(scaErrorMessage(e, 'Authentication failed. Try again.'));
        this.cdr.detectChanges();
      });
    }
  }

  private onStandingOrderCreated(order: StandingOrderCreateRequest) {
    const amount = formatMoney(order.amount.value, order.amount.currency);
    const beneficiary = order.counterparty.bankAccount.accountHolder.fullName;
    this.snack.open(
      `Scheduled transfer created: ${amount} to ${beneficiary}, ${this.getScheduleLabel(order.schedule).toLowerCase()}.`,
      'Close',
      { duration: 5000, panelClass: 'fintech-snack-success' }
    );
    this.pendingStandingOrder = null;
    this.scaInitiateResult = null;
    this.showSoList();
  }

  onSoApprovedOnPhone() {
    const order = this.pendingStandingOrder;
    this.showSoScaModal = false;
    this.soRemoteStart = null;
    if (order) this.onStandingOrderCreated(order);
    this.cdr.detectChanges();
  }

  cancelSoSca() {
    if (this.isCreating) return;
    this.showSoScaModal = false;
    this.soRemoteStart = null;
    this.scaStatus = '';
  }

  /** The next operations of this page, and of the next visits in this browser, are approved the same way. */
  private chooseApproval(mode: ApprovalMode) {
    this.approval = { ...this.approval, mode };
    saveApprovalMode(this.userId, mode);
  }

  private toastError(message: string) {
    this.snack.open(message, 'Close', { duration: 6000, panelClass: 'fintech-snack-error' });
  }
}
