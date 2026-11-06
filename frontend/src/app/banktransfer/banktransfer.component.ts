import { Component, OnInit, OnDestroy, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  ApprovalChoice, ApprovalMode, ConfirmDialogDetail, ConfirmService, InlineAlertComponent, MoneyPipe, NotifyService, approvalChoice,
  formatMoney, fromMinorUnits, httpErrorMessage, saveApprovalMode, scaErrorMessage, toMinorUnits
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

/** A failed step, shown next to the action that failed, with the action that tries it again. */
export interface FlowError {
  title: string;
  message: string;
  retry: () => void;
}

type FlowContext = 'oneshot' | 'standing';

@Component({
  selector: 'app-banktransfer',
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
  private notify = inject(NotifyService);
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

  // ─── Shared VoP: an exact match is shown next to the name field, other results ask for a decision ───
  showPartialMatchModal = false;
  showNoMatchModal = false;
  suggestedName = '';
  private vopContext: FlowContext = 'oneshot';
  // Payee details the bank confirmed, so an edit of any of them hides "Name matches" again.
  private matchedPayee: Record<FlowContext, string> = { oneshot: '', standing: '' };

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
  oneshotError: FlowError | null = null;

  // ─── Standing orders state ───
  standingOrders: StandingOrder[] = [];
  soLoading = true;
  soError = '';
  soView: 'list' | 'create' | 'edit' = 'list';
  deletingSoId: string | null = null;
  soActionError: FlowError | null = null;

  createForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    counterpartyName: ['', [Validators.required]],
    counterpartyCountry: ['', [Validators.required]],
    iban: [''],
    accountNumber: [''],
    routingNumber: [''],
    sortCode: [''],
    schedule: ['monthly', [Validators.required]],
    priority: [null as string | null, [Validators.required]],
    reference: [''],
    description: [''],
    referenceForBeneficiary: ['']
  });
  readonly standingBank = new BankDetailsCheck(this.createForm, this.transferService, () => this.cdr.detectChanges());

  isCreating = false;
  scaStatus = '';
  soCreateError: FlowError | null = null;

  editingOrder: StandingOrder | null = null;
  editRouteBeneficiary: TransferRouteRequest | null = null;
  editForm = this.fb.group({
    reference: [''],
    description: [''],
    referenceForBeneficiary: [''],
    priority: ['regular']
  });
  isSaving = false;
  editError: FlowError | null = null;

  showSoScaModal = false;
  scaInitiateResult: StandingOrderInitiateResponse | null = null;
  pendingStandingOrder: StandingOrderCreateRequest | null = null;
  /** Creates the approval of the scheduled transfer on the phone. */
  soRemoteStart: (() => Observable<RemoteSession>) | null = null;

  // ─────────── Lifecycle ───────────

  constructor() {
    // An edit answers the error: it disappears as soon as the person changes the form.
    this.oneshotForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (!this.showOneshotScaModal) this.oneshotError = null;
    });
    this.createForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (!this.showSoScaModal) this.soCreateError = null;
    });
    this.editForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.editError = null);
  }

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
        this.countriesError = httpErrorMessage(err, "The recipient countries couldn't be loaded. Try again.");
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

  onDeviceRegistered() {
    this.hasDevices = true;
    this.notify.success('Device registered. You can now make transfers.');
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

  /** The bank confirmed the beneficiary name for the details currently in the form. */
  nameMatches(context: FlowContext): boolean {
    const matched = this.matchedPayee[context];
    return !!matched && matched === this.payeeKey(context);
  }

  private payeeKey(context: FlowContext): string {
    return JSON.stringify(this.verifyPayloadOf(context));
  }

  acceptSuggestedName() {
    const context = this.vopContext;
    this.showPartialMatchModal = false;
    if (context === 'oneshot') {
      this.oneshotForm.patchValue({ accountHolderName: this.suggestedName });
    } else {
      this.createForm.patchValue({ counterpartyName: this.suggestedName });
    }
    this.matchedPayee[context] = this.payeeKey(context);
    this.review(context);
  }

  proceedWithRisk() {
    this.showNoMatchModal = false;
    this.review(this.vopContext, "The name on the account doesn't match the beneficiary name you entered.");
  }

  private review(context: FlowContext, warning = '') {
    if (context === 'oneshot') {
      this.reviewOneshot(warning);
    } else {
      this.reviewStandingOrder(warning);
    }
  }

  modifyInfo() {
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

  private verifyPayloadOf(context: FlowContext): VerifyCounterpartyNameRequest {
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

  /** Verification of payee, then the review directly on a match, or a dialog to decide on a partial match or no match. */
  private verifyPayee(context: FlowContext, next: () => void, setBusy: (busy: boolean) => void, setError: (error: FlowError) => void) {
    this.vopContext = context;
    const country = context === 'oneshot' ? this.oneshotForm.value.counterpartyCountry : this.createForm.value.counterpartyCountry;
    if (!this.findRecipientCountry(country)?.payeeVerification || this.nameMatches(context)) {
      next();
      return;
    }
    const payeeKey = this.payeeKey(context);

    setBusy(true);
    this.transferService.verifyCounterpartyName(this.verifyPayloadOf(context)).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          setBusy(false);
          if (res.response === 'nameMatch') {
            this.matchedPayee[context] = payeeKey;
            next();
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
          setError({
            title: 'Unable to check the beneficiary name',
            message: httpErrorMessage(err, "The beneficiary name couldn't be checked with their bank. Try again."),
            retry: () => context === 'oneshot' ? this.submitOneshot() : this.onCreateSo()
          });
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

  amountError(control: FlowContext): string {
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
    this.oneshotError = null;
    this.verifyPayee('oneshot', () => this.reviewOneshot(), busy => this.isOneshotProcessing = busy, error => this.oneshotError = error);
  }

  retryOneshot() {
    const error = this.oneshotError;
    this.oneshotError = null;
    error?.retry();
  }

  /** Nothing is sent and no approval is created on a phone before the person confirms this recap. */
  private async reviewOneshot(warning = '') {
    const recap = this.buildOneshotRecap();
    const amount = formatMoney(recap.amount, recap.currency);
    const details: ConfirmDialogDetail[] = [
      { label: 'Amount', value: amount },
      { label: 'Beneficiary', value: recap.beneficiary },
      ...this.nameCheckDetail('oneshot'),
      { label: 'Country', value: recap.country },
      ...recap.accountRows,
      { label: 'Speed', value: recap.speed }
    ];
    if (recap.reference) details.push({ label: 'Reference', value: recap.reference });
    if (recap.description) details.push({ label: 'Description', value: recap.description });

    const confirmed = await this.confirmService.confirm({
      title: `Send ${amount} to ${recap.beneficiary}?`,
      message: warning || undefined,
      details,
      confirmText: `Send ${amount}`,
      cancelText: 'Edit'
    });
    this.ngZone.run(() => {
      if (confirmed) this.initiateTransferFlow();
      this.cdr.detectChanges();
    });
  }

  private nameCheckDetail(context: FlowContext): ConfirmDialogDetail[] {
    return this.nameMatches(context) ? [{ label: 'Name check', value: 'Name matches' }] : [];
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
        error: (err) => this.failOneshotStart(httpErrorMessage(err, "The transfer couldn't be started. Try again."))
      });
    } catch (e) {
      this.failOneshotStart(scaErrorMessage(e, "The authentication couldn't be started. Try again."));
    }
  }

  /** Back to the form, which kept its values. The modal is already open when the user switched to this browser. */
  private failOneshotStart(message: string) {
    this.ngZone.run(() => {
      this.isOneshotProcessing = false;
      this.showOneshotScaModal = false;
      this.oneshotError = { title: 'Unable to start the transfer', message, retry: () => this.submitOneshot() };
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
    this.oneshotError = null;
    this.showOneshotScaModal = false;
    this.oneshotRemoteStart = null;
    this.oneshotAuthParam = '';
  }

  async approveOneshot() {
    if (!this.oneshotAuthParam || !this.oneshotDraft) return;
    this.isOneshotProcessing = true;
    this.oneshotError = null;
    const draft = this.oneshotDraft;
    const fail = (message: string) => {
      this.isOneshotProcessing = false;
      this.oneshotError = { title: 'Unable to send the transfer', message, retry: () => this.approveOneshot() };
      this.cdr.detectChanges();
    };

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
        error: (err) => this.ngZone.run(() => fail(httpErrorMessage(err, "The transfer couldn't be completed. Try again.")))
      });
    } catch (e) {
      this.ngZone.run(() => fail(scaErrorMessage(e, 'Authentication failed. Try again.')));
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
    this.oneshotError = null;
    this.matchedPayee.oneshot = '';
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
        this.soError = httpErrorMessage(err, "The scheduled transfers couldn't be loaded. Try again.");
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
    this.soCreateError = null;
    this.soActionError = null;
    this.matchedPayee.standing = '';
    this.standingBank.setFormat(null);
    this.createForm.reset({
      amount: null,
      counterpartyName: '',
      counterpartyCountry: '',
      schedule: 'monthly',
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
    this.soCreateError = null;
    this.editError = null;
    this.standingBank.setFormat(null);
    this.loadStandingOrders();
  }

  showSoEdit(order: StandingOrder) {
    this.editingOrder = order;
    this.editRouteBeneficiary = this.routeBeneficiaryOf(order);
    this.soView = 'edit';
    this.soActionError = null;
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
      cancelText: 'Keep it',
      danger: true
    });
    if (!confirmed) return;

    this.deletingSoId = order.id;
    this.soActionError = null;
    this.cdr.detectChanges();
    this.soService.delete(this.userId, order.id).subscribe({
      next: () => {
        this.deletingSoId = null;
        this.notify.success('Scheduled transfer deleted');
        this.loadStandingOrders();
      },
      error: (err) => {
        this.deletingSoId = null;
        this.soActionError = {
          title: `Unable to delete the scheduled transfer to ${this.soBeneficiary(order)}`,
          message: httpErrorMessage(err, "The scheduled transfer couldn't be deleted. Try again."),
          retry: () => this.onDeleteSo(order)
        };
        this.cdr.detectChanges();
      }
    });
  }

  retrySoAction() {
    const error = this.soActionError;
    this.soActionError = null;
    error?.retry();
  }

  onSaveEdit() {
    if (!this.editingOrder || this.isSaving || this.editForm.invalid) return;
    this.isSaving = true;
    this.editError = null;

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
        this.notify.success('Scheduled transfer updated');
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSaving = false;
        this.editError = {
          title: 'Unable to save the changes',
          message: httpErrorMessage(err, "The scheduled transfer couldn't be updated. Try again."),
          retry: () => this.onSaveEdit()
        };
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
      schedule: f.schedule || 'monthly',
      priorities: [f.priority || 'regular'],
      reference: f.reference || '',
      description: f.description || '',
      referenceForBeneficiary: f.referenceForBeneficiary || ''
    };
  }

  onCreateSo() {
    if (this.createBlockReason || this.isCreating) return;
    this.soCreateError = null;
    this.verifyPayee('standing', () => this.reviewStandingOrder(), busy => this.isCreating = busy, error => this.soCreateError = error);
  }

  retrySoCreate() {
    const error = this.soCreateError;
    this.soCreateError = null;
    error?.retry();
  }

  /** Nothing is created, here or on a phone, before the person confirms this recap. */
  private async reviewStandingOrder(warning = '') {
    const order = this.buildCreatePayload();
    const f = this.createForm.value;
    const amount = formatMoney(order.amount.value, order.amount.currency);
    const beneficiary = order.counterparty.bankAccount.accountHolder.fullName;
    const details: ConfirmDialogDetail[] = [
      { label: 'Amount per transfer', value: amount },
      { label: 'Beneficiary', value: beneficiary },
      ...this.nameCheckDetail('standing'),
      { label: 'Country', value: countryName(f.counterpartyCountry) },
      ...bankDetailRows(this.standingBank.normalized()),
      { label: 'Schedule', value: this.getScheduleLabel(order.schedule) },
      { label: 'Speed', value: speedLabel(order.priorities[0]) }
    ];
    if (order.reference) details.push({ label: 'Reference', value: order.reference });
    if (order.description) details.push({ label: 'Description', value: order.description });

    const confirmed = await this.confirmService.confirm({
      title: `Schedule ${amount} to ${beneficiary}?`,
      message: warning || undefined,
      details,
      confirmText: 'Schedule transfer',
      cancelText: 'Edit'
    });
    this.ngZone.run(() => {
      if (confirmed) this.initiateStandingOrderFlow();
      this.cdr.detectChanges();
    });
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
      this.scaStatus = 'Checking passkey availability…';
      this.cdr.detectChanges();
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutputInit = await scaWebauthn.checkAvailability();

      this.scaStatus = 'Scheduling the transfer…';
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
              this.failSoStart("The transfer couldn't be scheduled because of an unexpected response. Try again.");
            }
            this.cdr.detectChanges();
          });
        },
        error: (err) => this.failSoStart(httpErrorMessage(err, "The transfer couldn't be scheduled. Try again."))
      });
    } catch (e) {
      this.failSoStart(scaErrorMessage(e, "The authentication couldn't be started. Try again."));
    }
  }

  /** Back to the form, which kept its values. The modal is already open when the user switched to this browser. */
  private failSoStart(message: string) {
    this.ngZone.run(() => {
      this.isCreating = false;
      this.scaStatus = '';
      this.showSoScaModal = false;
      this.soCreateError = { title: 'Unable to schedule the transfer', message, retry: () => this.onCreateSo() };
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
    this.soCreateError = null;
    const standingOrder = this.pendingStandingOrder;
    const fail = (message: string) => {
      this.isCreating = false;
      this.scaStatus = '';
      this.soCreateError = { title: 'Unable to schedule the transfer', message, retry: () => this.approveSoScaChallenge() };
      this.cdr.detectChanges();
    };

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      this.scaStatus = 'Waiting for your passkey…';
      this.cdr.detectChanges();

      const sdkOutput = await scaWebauthn.authenticate(this.scaInitiateResult.authParam1);

      this.scaStatus = 'Scheduling the transfer…';
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
        error: (err) => this.ngZone.run(() => fail(httpErrorMessage(err, "The transfer couldn't be scheduled. Try again.")))
      });
    } catch (e) {
      this.ngZone.run(() => fail(scaErrorMessage(e, 'Authentication failed. Try again.')));
    }
  }

  private onStandingOrderCreated(order: StandingOrderCreateRequest) {
    const amount = formatMoney(order.amount.value, order.amount.currency);
    const beneficiary = order.counterparty.bankAccount.accountHolder.fullName;
    this.notify.success(`Transfer scheduled: ${amount} to ${beneficiary}, ${this.getScheduleLabel(order.schedule).toLowerCase()}.`);
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
    this.soCreateError = null;
  }

  /** The next operations of this page, and of the next visits in this browser, are approved the same way. */
  private chooseApproval(mode: ApprovalMode) {
    this.approval = { ...this.approval, mode };
    saveApprovalMode(this.userId, mode);
  }

}
