import {
  Component, signal, computed, inject, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, HostListener
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { OnboardingPart, OnboardingResponse, User, BankAccountStatus, BusinessLine, WebhookEvent } from '../models';
import {
  AccountService, OnboardingService, SessionService, ActivityService, TransferService, IssuingService, WebhookService,
  DemoDataService, demoDataSummary
} from '../services';
import { MaterialModule } from '../material.module';
import { INDUSTRY_CODES } from '../industry-codes';
import { InlineAlertComponent, NotifyService, httpErrorMessage } from '../shared';
import '@adyen/kyc-components/transfer-instrument-management';
import '@adyen/kyc-components/transfer-instrument-configuration';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface CapabilityRow {
  key: string;
  label: string;
  part?: OnboardingPart;
}

export interface CapabilityStatus {
  label: string;
  description: string;
  tone: StatusTone;
  icon: string;
}

export type ChecklistState = 'done' | 'todo' | 'in-progress' | 'blocked' | 'loading';

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  state: ChecklistState;
  statusLabel: string;
  action?: { label: string; link?: string[]; run?: () => void };
}

export interface QuickAction {
  label: string;
  description: string;
  icon: string;
  link: string[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    InlineAlertComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private static readonly BANK_STATUS_POLL_INTERVAL = 5000;
  private bankStatusInterval: ReturnType<typeof setInterval> | null = null;

  private accountService = inject(AccountService);
  private onboardingService = inject(OnboardingService);
  private sessionService = inject(SessionService);
  private activityService = inject(ActivityService);
  private transferService = inject(TransferService);
  private issuingService = inject(IssuingService);
  private webhookService = inject(WebhookService);
  private demoDataService = inject(DemoDataService);
  private route = inject(ActivatedRoute);
  private notify = inject(NotifyService);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  userId = '';
  readonly user = signal<User | null>(null);
  readonly userLoading = signal(false);
  readonly userError = signal<string | null>(null);

  readonly status = signal<OnboardingResponse | null>(null);
  readonly loading = signal(false);
  readonly kycError = signal<string | null>(null);
  readonly openingOnboarding = signal(false);
  readonly onboardingLinkError = signal<string | null>(null);
  private awaitingOnboardingReturn = false;

  readonly bankStatus = signal<BankAccountStatus | null>(null);
  readonly bankStatusError = signal<string | null>(null);
  readonly creatingBankAccount = signal(false);
  readonly bankCreateError = signal<string | null>(null);

  readonly deviceCount = signal<number | null>(null);
  readonly cardCount = signal<number | null>(null);
  readonly paymentReceived = signal<boolean | null>(null);

  readonly businessLines = signal<BusinessLine[]>([]);
  readonly businessLinesError = signal<string | null>(null);
  readonly loadingKyc = signal(false);
  readonly validateKycError = signal<string | null>(null);
  readonly loadingDemo = signal(false);
  readonly demoLoaded = signal(false);
  readonly demoError = signal<string | null>(null);
  readonly demoWarnings = signal<string[]>([]);
  readonly salesChannelError = signal<string | null>(null);
  readonly addBusinessLineError = signal<string | null>(null);
  submitting = false;

  readonly INDUSTRY_CODES = INDUSTRY_CODES;
  filteredIndustries = [...INDUSTRY_CODES];
  industrySearch = '';

  businessForm: FormGroup;

  readonly capabilities = computed<CapabilityRow[]>(() => {
    const u = this.user();
    const s = this.status();
    const rows: CapabilityRow[] = [
      { key: 'acquiring', label: 'Payments', part: s?.acquiringStatus },
      { key: 'payout', label: 'Payouts', part: s?.payoutStatus }
    ];
    if (u?.capital) rows.push({ key: 'capital', label: 'Business loans', part: s?.capitalStatus });
    if (u?.bank) rows.push({ key: 'banking', label: 'Business bank account', part: s?.bankingStatus });
    if (u?.issuing) rows.push({ key: 'issuing', label: 'Card issuing', part: s?.issuingStatus });
    return rows;
  });

  readonly checklist = computed<ChecklistItem[]>(() => {
    const u = this.user();
    if (!u) return [];
    const items: ChecklistItem[] = [this.verificationStep()];
    if (u.bank) {
      items.push(this.bankAccountStep(), this.deviceStep());
    }
    items.push(this.paymentStep());
    if (u.issuing) {
      items.push(this.cardStep());
    }
    return items;
  });

  readonly completedSteps = computed(() => this.checklist().filter(i => i.state === 'done').length);

  readonly quickActions = computed<QuickAction[]>(() => {
    const u = this.user();
    if (!u) return [];
    const id = this.userId;
    const actions: QuickAction[] = [
      { label: 'Transactions', description: 'Review payments', icon: 'receipt_long', link: ['/', id, 'transactions'] },
      { label: 'Checkout', description: 'Make a test payment', icon: 'shopping_cart', link: ['/', id, 'checkout'] },
      { label: 'Invoices', description: 'Bill customers by payment link', icon: 'request_quote', link: ['/', id, 'invoices'] },
      { label: 'Subscriptions', description: 'Charge customers every cycle', icon: 'autorenew', link: ['/', id, 'subscriptions'] },
      ...(u.bank || u.issuing
        ? [{ label: 'Bills', description: 'Pay suppliers in one batch', icon: 'receipt', link: ['/', id, 'bills'] }]
        : []),
      { label: 'Accounting', description: 'Matched journal and exports', icon: 'menu_book', link: ['/', id, 'accounting'] },
      { label: 'Reports', description: 'Download financial reports', icon: 'description', link: ['/', id, 'report'] },
      { label: 'Notifications', description: 'Account and payment events', icon: 'notifications', link: ['/', id, 'notifications'] }
    ];
    if (u.bank && this.bankStatus()?.bankAccountCreated) {
      actions.push({ label: 'Business account', description: 'Balance and transfers', icon: 'account_balance', link: ['/', id, 'business-account'] });
    }
    if (u.issuing) {
      actions.push({ label: 'Cards', description: 'Manage issued cards', icon: 'credit_card', link: ['/', id, 'cards'] });
    }
    if (u.capital) {
      actions.push({ label: 'Loans', description: 'Business financing', icon: 'savings', link: ['/', id, 'businessloans'] });
    }
    actions.push({ label: 'Disputes', description: 'Respond to chargebacks', icon: 'gavel', link: ['/', id, 'dispute'] });
    return actions;
  });

  constructor() {
    this.businessForm = this.fb.group({
      industryCode: ['', Validators.required],
      pos: [false],
      eCommerce: [false],
      payByLink: [false]
    });
    this.businessForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.salesChannelError() && this.selectedSalesChannels().length) this.salesChannelError.set(null);
    });
  }

  ngOnInit() {
    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      this.resetState();
      if (this.userId) {
        this.loadUser();
      }
    });
  }

  ngOnDestroy() {
    this.stopBankStatusPolling();
  }

  @HostListener('window:focus')
  onWindowFocus() {
    if (this.awaitingOnboardingReturn) {
      this.awaitingOnboardingReturn = false;
      this.checkOnboarding();
    }
  }

  private resetState() {
    this.stopBankStatusPolling();
    this.user.set(null);
    this.status.set(null);
    this.kycError.set(null);
    this.bankStatus.set(null);
    this.bankStatusError.set(null);
    this.bankCreateError.set(null);
    this.deviceCount.set(null);
    this.cardCount.set(null);
    this.paymentReceived.set(null);
    this.businessLines.set([]);
    this.demoLoaded.set(false);
    this.demoError.set(null);
    this.demoWarnings.set([]);
  }

  loadUser() {
    this.userLoading.set(true);
    this.userError.set(null);
    this.accountService.getUserById(this.userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (u) => {
        this.user.set(u);
        this.userLoading.set(false);
        this.checkOnboarding();
        this.loadPaymentActivity();
        if (u.bank) {
          this.loadBankAccountStatus();
          this.startBankStatusPolling();
        }
        if (u.issuing) {
          this.loadCards();
        }
        if (u.activityReason === 'embeddedPayment') {
          this.loadBusinessLines();
        }
        if (u.legalEntityId) {
          this.initTransferInstrumentComponent(u.legalEntityId);
        }
      },
      error: (err) => {
        this.userLoading.set(false);
        this.userError.set(httpErrorMessage(err, 'Unable to load the account. Check the connection and try again.'));
      }
    });
  }

  openHostedOnboarding() {
    if (this.openingOnboarding()) return;
    // Opened synchronously so the browser keeps the click as the trigger and does not block the popup.
    const popup = window.open('', '_blank');
    this.openingOnboarding.set(true);
    this.onboardingLinkError.set(null);
    this.onboardingService.getOnboardingLink(this.userId).subscribe({
      next: (res) => {
        this.openingOnboarding.set(false);
        if (popup && !popup.closed) {
          popup.opener = null;
          popup.location.href = res.url;
        } else {
          window.open(res.url, '_blank', 'noopener');
        }
        this.awaitingOnboardingReturn = true;
      },
      error: (err) => {
        this.openingOnboarding.set(false);
        popup?.close();
        this.onboardingLinkError.set(httpErrorMessage(err, 'Unable to open the onboarding page. Try again.'));
      }
    });
  }

  checkOnboarding(): void {
    if (!this.userId) return;
    this.loading.set(true);
    this.kycError.set(null);
    this.onboardingService.getOnboardingStatus(this.userId).subscribe({
      next: (res) => {
        this.status.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.kycError.set(httpErrorMessage(err, 'Unable to load the verification status. Try again.'));
      }
    });
  }

  private isActive(part?: OnboardingPart): boolean {
    return !!part && part.verificationStatus === 'valid' && part.allowed;
  }

  /** True only when every capability relevant to the account is both verified and allowed. */
  allValid(): boolean {
    return this.capabilities().every(row => this.isActive(row.part));
  }

  pendingCapabilities(): CapabilityRow[] {
    return this.capabilities().filter(row => !this.isActive(row.part));
  }

  pendingLabels(): string {
    return this.pendingCapabilities().map(row => row.label.toLowerCase()).join(', ');
  }

  getCapabilityStatus(part: OnboardingPart | undefined): CapabilityStatus {
    if (!part) {
      return { label: 'No information', description: 'No status was returned for this capability.', tone: 'neutral', icon: 'help_outline' };
    }

    switch (part.verificationStatus) {
      case 'invalid':
        return { label: 'Action required', description: 'Information is missing or incorrect. Continue onboarding to fix it.', tone: 'danger', icon: 'error_outline' };
      case 'pending':
        return { label: 'In review', description: 'Your information is being verified.', tone: 'warning', icon: 'schedule' };
      case 'rejected':
      case 'reject':
        return { label: 'Rejected', description: 'Verification was rejected. Contact support to find out why.', tone: 'danger', icon: 'block' };
      case 'valid':
        return part.allowed
          ? { label: 'Active', description: 'Verified and ready to use.', tone: 'success', icon: 'check_circle' }
          : { label: 'Verified, not allowed yet', description: 'Verified, waiting to be enabled.', tone: 'warning', icon: 'hourglass_empty' };
      default:
        return { label: 'Unknown', description: 'Unrecognized status. Refresh to check again.', tone: 'neutral', icon: 'help_outline' };
    }
  }

  private verificationStep(): ChecklistItem {
    const base = {
      id: 'verification',
      title: 'Complete verification',
      description: this.user()?.companyImported
        ? 'Your company details came from your system. Add the rest to verify your account (KYC).'
        : 'Provide your business details to verify your account (KYC).'
    };
    const continueAction = { label: 'Continue onboarding', run: () => this.openHostedOnboarding() };
    const s = this.status();

    if (!s) {
      if (this.kycError()) {
        return { ...base, state: 'todo', statusLabel: 'Status unavailable', action: { label: 'Try again', run: () => this.checkOnboarding() } };
      }
      return { ...base, state: 'loading', statusLabel: 'Checking status…' };
    }
    if (this.allValid()) {
      return { ...base, state: 'done', statusLabel: 'Verified' };
    }
    const parts = this.capabilities().map(c => c.part);
    if (parts.some(p => p?.verificationStatus === 'rejected' || p?.verificationStatus === 'reject')) {
      return { ...base, state: 'blocked', statusLabel: 'Rejected, contact support' };
    }
    if (parts.some(p => !p || p.verificationStatus === 'invalid')) {
      return { ...base, state: 'todo', statusLabel: 'Information required', action: continueAction };
    }
    return { ...base, state: 'in-progress', statusLabel: 'In review', action: { label: 'Refresh status', run: () => this.checkOnboarding() } };
  }

  private bankAccountStep(): ChecklistItem {
    const base = {
      id: 'bank-account',
      title: 'Create a business bank account',
      description: 'Get a dedicated account to receive funds and make transfers.'
    };
    const bs = this.bankStatus();
    if (!bs) {
      return this.bankStatusError()
        ? { ...base, state: 'todo', statusLabel: 'Status unavailable', action: { label: 'Try again', run: () => this.retryBankAccountStatus() } }
        : { ...base, state: 'loading', statusLabel: 'Checking status…' };
    }
    if (bs.bankAccountCreated) {
      return { ...base, state: 'done', statusLabel: 'Created', action: { label: 'Open', link: ['/', this.userId, 'business-account'] } };
    }
    if (!bs.bankingAllowed) {
      return { ...base, state: 'blocked', statusLabel: 'Available after verification' };
    }
    return { ...base, state: 'todo', statusLabel: 'Ready to create', action: { label: 'Create account', run: () => this.scrollToBankCard() } };
  }

  private deviceStep(): ChecklistItem {
    const base = {
      id: 'device',
      title: 'Register a trusted device',
      description: 'Use a passkey to approve transfers from your business account.'
    };
    if (!this.bankStatus()?.bankAccountCreated) {
      return { ...base, state: 'blocked', statusLabel: 'Available after the bank account is created' };
    }
    const link = ['/', this.userId, 'business-account-device'];
    const count = this.deviceCount();
    if (count === null) {
      return { ...base, state: 'todo', statusLabel: 'To do', action: { label: 'Register device', link } };
    }
    return count > 0
      ? { ...base, state: 'done', statusLabel: count === 1 ? '1 device registered' : `${count} devices registered`, action: { label: 'Manage', link } }
      : { ...base, state: 'todo', statusLabel: 'No device yet', action: { label: 'Register device', link } };
  }

  private paymentStep(): ChecklistItem {
    const base = {
      id: 'payment',
      title: 'Make your first payment',
      description: 'Try the checkout with a test card and see the payment in your transactions.'
    };
    const link = ['/', this.userId, 'checkout'];
    return this.paymentReceived()
      ? { ...base, state: 'done', statusLabel: 'Payment received', action: { label: 'View transactions', link: ['/', this.userId, 'transactions'] } }
      : { ...base, state: 'todo', statusLabel: 'To do', action: { label: 'Go to checkout', link } };
  }

  private cardStep(): ChecklistItem {
    const base = {
      id: 'card',
      title: 'Issue your first card',
      description: 'Create a virtual or physical card linked to your balance account.'
    };
    const issuing = this.status()?.issuingStatus;
    if (this.status() && !this.isActive(issuing) && !this.cardCount()) {
      return { ...base, state: 'blocked', statusLabel: 'Available once card issuing is allowed' };
    }
    const count = this.cardCount();
    if (count) {
      return { ...base, state: 'done', statusLabel: count === 1 ? '1 card issued' : `${count} cards issued`, action: { label: 'View cards', link: ['/', this.userId, 'cards'] } };
    }
    return { ...base, state: 'todo', statusLabel: 'To do', action: { label: 'Create card', link: ['/', this.userId, 'card-create'] } };
  }

  runChecklistAction(item: ChecklistItem) {
    item.action?.run?.();
  }

  private scrollToBankCard() {
    const card = document.getElementById('business-bank-account');
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card?.focus({ preventScroll: true });
  }

  private loadPaymentActivity() {
    this.webhookService.getEvents(this.userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (events) => this.paymentReceived.set(events.some(e => this.isSuccessfulPayment(e))),
      error: () => this.paymentReceived.set(null)
    });
  }

  private isSuccessfulPayment(event: WebhookEvent): boolean {
    if (event.eventType === 'CAPTURE') return true;
    return event.eventType === 'AUTHORISATION' && event.title !== 'Payment refused';
  }

  private loadCards() {
    this.issuingService.getCards(this.userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (cards) => this.cardCount.set(cards?.length ?? 0),
      error: () => this.cardCount.set(null)
    });
  }

  private loadDevices() {
    this.transferService.listDevices(this.userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (devices) => this.deviceCount.set(devices?.length ?? 0),
      error: () => this.deviceCount.set(null)
    });
  }

  getIndustryLabel(code: string): string {
    const ind = INDUSTRY_CODES.find(i => i.code === code);
    return ind ? ind.label : code;
  }

  getChannelLabel(channel: string): string {
    switch (channel) {
      case 'pos': return 'POS';
      case 'eCommerce': return 'Ecommerce';
      case 'payByLink': return 'Pay by Link';
      default: return channel;
    }
  }

  filterIndustries() {
    const term = this.industrySearch.toLowerCase();
    this.filteredIndustries = INDUSTRY_CODES.filter(
      i => i.label.toLowerCase().includes(term) || i.code.toLowerCase().includes(term)
    );
    const selected = this.businessForm.get('industryCode')!.value;
    if (selected && this.getIndustryLabel(selected) !== this.industrySearch) {
      this.businessForm.get('industryCode')!.setValue('');
    }
  }

  onIndustrySelected(code: string) {
    this.businessForm.get('industryCode')!.setValue(code);
    this.industrySearch = this.getIndustryLabel(code);
  }

  loadBusinessLines() {
    this.businessLinesError.set(null);
    this.activityService.getBusinessLines(this.userId).subscribe({
      next: (res) => this.businessLines.set(res),
      error: (err) => this.businessLinesError.set(httpErrorMessage(err, 'Unable to load business activities. Try again.'))
    });
  }

  addBusinessLine() {
    if (this.businessForm.invalid) {
      this.businessForm.markAllAsTouched();
      return;
    }

    const { industryCode } = this.businessForm.value;
    const salesChannels = this.selectedSalesChannels();

    if (!salesChannels.length) {
      this.salesChannelError.set('Select at least one sales channel.');
      return;
    }

    this.submitting = true;
    this.addBusinessLineError.set(null);
    this.activityService.addBusinessLine(this.userId, { industryCode, salesChannels }).subscribe({
      next: (res) => {
        this.businessLines.set([...this.businessLines(), res]);
        this.notify.success('Business activity added.');
        this.businessForm.reset({ industryCode: '', pos: false, eCommerce: false, payByLink: false });
        this.industrySearch = '';
        this.filteredIndustries = [...INDUSTRY_CODES];
        this.submitting = false;
      },
      error: (err) => {
        this.addBusinessLineError.set(httpErrorMessage(err, 'Unable to add this business activity. Try again.'));
        this.submitting = false;
      }
    });
  }

  private selectedSalesChannels(): string[] {
    const { pos, eCommerce, payByLink } = this.businessForm.value;
    const channels: string[] = [];
    if (pos) channels.push('pos');
    if (eCommerce) channels.push('eCommerce');
    if (payByLink) channels.push('payByLink');
    return channels;
  }

  private tiLegalEntityId = '';

  private getFetchToken() {
    return async () => {
      const session = await firstValueFrom(this.sessionService.getExternalBankAccountSession(this.userId));
      if (!session) throw new Error('Failed to get session token');
      return { token: session.token };
    };
  }

  private initTransferInstrumentComponent(legalEntityId: string) {
    this.tiLegalEntityId = legalEntityId;
    setTimeout(() => this.showManagementComponent());
  }

  private showManagementComponent() {
    const container = document.getElementById('ti-management-container');
    if (!container) return;
    container.innerHTML = '';

    const el = document.createElement('adyen-transfer-instrument-management') as any;
    el.locale = 'en-US';
    el.environment = 'test';
    el.rootlegalentityid = this.tiLegalEntityId;
    el.fetchToken = this.getFetchToken();
    el.addEventListener('add', () => {
      this.showConfigurationComponent();
    });
    el.addEventListener('edit', (e: any) => {
      const transferInstrumentId = e.detail;
      this.showConfigurationComponent(transferInstrumentId);
    });

    container.appendChild(el);
  }

  private showConfigurationComponent(transferInstrumentId?: string) {
    const container = document.getElementById('ti-management-container');
    if (!container) return;
    container.innerHTML = '';

    const el = document.createElement('adyen-transfer-instrument-configuration') as any;
    el.locale = 'en-US';
    el.environment = 'test';
    el.rootlegalentityid = this.tiLegalEntityId;
    el.fetchToken = this.getFetchToken();
    el.settings = {
      allowIntraRegionCrossBorderPayout: true,
      allowBankAccountFormatSelection: true
    };
    if (transferInstrumentId) {
      el.transferInstrumentId = transferInstrumentId;
    }
    el.addEventListener('complete', () => {
      this.showManagementComponent();
    });

    container.appendChild(el);
  }

  loadBankAccountStatus() {
    if (!this.userId) return;
    this.accountService.getBankAccountStatus(this.userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (status) => {
        const wasCreated = this.bankStatus()?.bankAccountCreated;
        this.bankStatus.set(status);
        this.bankStatusError.set(null);
        if (status.bankAccountCreated) {
          this.stopBankStatusPolling();
          if (!wasCreated) this.loadDevices();
        }
      },
      error: (err) => {
        if (!this.bankStatus()) {
          this.bankStatusError.set(httpErrorMessage(err, 'Unable to load the bank account status. Try again.'));
        }
      }
    });
  }

  retryBankAccountStatus() {
    this.bankStatusError.set(null);
    this.loadBankAccountStatus();
    this.startBankStatusPolling();
  }

  private startBankStatusPolling() {
    this.stopBankStatusPolling();
    this.bankStatusInterval = setInterval(() => {
      this.loadBankAccountStatus();
    }, DashboardComponent.BANK_STATUS_POLL_INTERVAL);
  }

  private stopBankStatusPolling() {
    if (this.bankStatusInterval) {
      clearInterval(this.bankStatusInterval);
      this.bankStatusInterval = null;
    }
  }

  createBankAccount() {
    if (!this.userId || this.creatingBankAccount() || !this.bankStatus()?.bankingAllowed) return;
    this.creatingBankAccount.set(true);
    this.bankCreateError.set(null);

    this.accountService.createBankAccount(this.userId).subscribe({
      next: (res) => {
        this.creatingBankAccount.set(false);
        const current = this.bankStatus();
        if (current) {
          this.bankStatus.set({ ...current, bankAccountCreated: true, bankAccountId: res.bankAccountId, bankAccountNumber: res.bankAccountNumber });
        }
        this.stopBankStatusPolling();
        this.loadBankAccountStatus();
        this.accountService.notifyBankAccountCreated();
        this.notify.success(`Business bank account created: ${res.bankAccountNumber}`);
      },
      error: (err) => {
        this.creatingBankAccount.set(false);
        this.bankCreateError.set(httpErrorMessage(err, 'Unable to create the bank account. Try again.'));
      }
    });
  }

  /** Creates what's missing, so loading it again doesn't duplicate anything. */
  loadDemoData() {
    const userId = this.userId;
    if (!userId || this.loadingDemo()) return;
    this.loadingDemo.set(true);
    this.demoError.set(null);
    this.demoWarnings.set([]);
    this.demoDataService.load(userId).subscribe({
      next: (result) => {
        this.loadingDemo.set(false);
        if (userId !== this.userId) return;
        this.demoLoaded.set(true);
        this.demoWarnings.set(result.warnings ?? []);
        this.notify.success(demoDataSummary(result));
      },
      error: (err) => {
        this.loadingDemo.set(false);
        this.demoError.set(httpErrorMessage(err, 'Unable to load the demo data. Try again.'));
      }
    });
  }

  validateKyc(userId: string) {
    if (!userId || this.loadingKyc()) return;

    this.loadingKyc.set(true);
    this.validateKycError.set(null);

    this.onboardingService.validateKyc(userId).subscribe({
      next: () => {
        this.loadingKyc.set(false);
        this.notify.success('KYC validated. Refreshing the status…');
        this.checkOnboarding();
        if (this.user()?.bank) this.loadBankAccountStatus();
      },
      error: (err) => {
        this.loadingKyc.set(false);
        this.validateKycError.set(httpErrorMessage(err, 'Unable to validate KYC. Try again.'));
      }
    });
  }
}
