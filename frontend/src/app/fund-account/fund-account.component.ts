import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MaterialModule } from '../material.module';
import { TopUpBankAccount, TopUpContext, TopUpResult, TopUpSchedule, TopUpSweep } from '../models/top-up.model';
import { BrandingService } from '../services/branding.service';
import { TopUpService } from '../services/top-up.service';
import { ConfirmService, InlineAlertComponent, MoneyPipe, NotifyService, formatMoney, httpErrorMessage, toMinorUnits } from '../shared';
import { DEFAULT_PLATFORM_NAME } from '../layout/page-title.strategy';

type LoadState = 'loading' | 'ready' | 'error';

const SUBMITTED_RESULTS = ['Authorised', 'Received', 'Pending'];
const BANK_STATUS_LABELS: Record<string, string> = {
  verified: 'Verified',
  pending: 'Verification in progress',
  actionRequired: 'Action required',
  unknown: 'Status unavailable'
};

@Component({
  selector: 'app-fund-account',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, MaterialModule, InlineAlertComponent, MoneyPipe],
  templateUrl: './fund-account.component.html',
  styleUrl: './fund-account.component.css'
})
export class FundAccountComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(TopUpService);
  private readonly branding = inject(BrandingService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifyService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  userId = '';
  context?: TopUpContext;
  contextState: LoadState = 'loading';
  contextError = '';
  bankAccounts: TopUpBankAccount[] = [];
  bankState: LoadState = 'loading';
  bankError = '';
  result?: TopUpResult;
  busy = false;
  error = '';
  platformName = DEFAULT_PLATFORM_NAME;
  readonly bank = this.fb.nonNullable.control('', Validators.required);
  readonly authorization = this.fb.nonNullable.group({ accepted: [false, Validators.requiredTrue], signatory: [false] });
  readonly form = this.fb.nonNullable.group({
    mode: ['once' as 'once' | 'recurring'],
    amount: [100, [Validators.required, Validators.min(0.01)]],
    schedule: ['monthly' as TopUpSchedule]
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.destroyed = true);
  }

  ngOnInit() {
    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      this.context = undefined;
      this.bankAccounts = [];
      this.result = undefined;
      this.bank.reset();
      this.authorization.reset();
      if (!this.userId) return;
      const userId = this.userId;
      this.branding.getBranding(userId).subscribe(value => {
        if (!this.isCurrent(userId)) return;
        // Payment service provider names are not part of the customer-facing mandate.
        this.platformName = (value?.platformName || DEFAULT_PLATFORM_NAME).replace(/adyen/gi, 'our payment service provider');
        this.cdr.markForCheck();
      });
      this.refresh();
    });
  }

  refresh() {
    void this.loadContext();
    void this.loadBankAccounts();
  }

  async loadContext() {
    const userId = this.userId;
    this.contextState = 'loading';
    this.contextError = '';
    try {
      const context = await firstValueFrom(this.api.context(userId));
      if (!this.isCurrent(userId)) return;
      this.context = context;
      this.contextState = 'ready';
    } catch (error) {
      if (!this.isCurrent(userId)) return;
      this.contextState = 'error';
      this.contextError = httpErrorMessage(error, 'The top-up details could not be loaded. Try again.');
    } finally {
      this.cdr.markForCheck();
    }
  }

  async loadBankAccounts() {
    const userId = this.userId;
    this.bankState = 'loading';
    this.bankError = '';
    try {
      const accounts = await firstValueFrom(this.api.bankAccounts(userId));
      if (!this.isCurrent(userId)) return;
      this.bankAccounts = accounts;
      this.bankState = 'ready';
      if (!accounts.some(a => a.transferInstrumentId === this.bank.value && this.selectable(a))) {
        this.bank.setValue(accounts.find(a => this.selectable(a))?.transferInstrumentId || '');
        this.authorization.reset();
      }
    } catch (error) {
      if (!this.isCurrent(userId)) return;
      this.bankState = 'error';
      this.bankError = httpErrorMessage(error, 'Your bank accounts could not be loaded. Try again.');
    } finally {
      this.cdr.markForCheck();
    }
  }

  get loading(): boolean {
    return this.contextState === 'loading' || this.bankState === 'loading';
  }

  get recurring(): boolean {
    return this.form.controls.mode.value === 'recurring';
  }

  get capabilitiesAllowed(): boolean {
    return this.allowed('receiveFromTransferInstrument') && this.allowed('receiveFromPlatformPayments');
  }

  get canTopUp(): boolean {
    return !!this.context?.businessAccountExists && !!this.context.paymentMethod;
  }

  get authorized(): boolean {
    return this.authorization.controls.accepted.value &&
      (this.context?.mandateKind !== 'BACS' || this.authorization.controls.signatory.value);
  }

  /** Why the submit button is disabled, or an empty string when it is enabled. */
  get blockReason(): string {
    if (this.loading) return '';
    if (!this.capabilitiesAllowed) return 'Direct debit permission is needed first.';
    if (!this.selectedBank) return 'Choose a verified bank account to debit.';
    if (!this.validMinorAmount()) return 'Enter an amount greater than zero.';
    if (!this.authorized) return 'Accept the direct debit authorization to continue.';
    return '';
  }

  get submitLabel(): string {
    const amount = this.validMinorAmount();
    if (this.recurring) return `Schedule ${this.form.controls.schedule.value} top-up`;
    return amount ? `Top up ${formatMoney(amount, this.context?.currency)}` : 'Top up';
  }

  /** One-line recap of what will be collected, shown above the submit button. */
  get summary(): string {
    const amount = this.validMinorAmount();
    if (!amount || !this.selectedBank) return '';
    const money = formatMoney(amount, this.context?.currency);
    const from = this.selectedBank.accountNumber;
    return this.recurring
      ? `${money} will be collected from ${from} ${this.frequency(this.form.controls.schedule.value)}, whatever your balance.`
      : `${money} will be collected once from ${from}.`;
  }

  get selectedBank(): TopUpBankAccount | undefined {
    const account = this.bankAccount(this.bank.value);
    return account && this.selectable(account) ? account : undefined;
  }

  get resultSubmitted(): boolean {
    return SUBMITTED_RESULTS.includes(this.result?.resultCode || '');
  }

  selectable(account: TopUpBankAccount): boolean {
    return account.status === 'verified' || account.status === 'unknown';
  }

  bankStatusLabel(status: string): string {
    return BANK_STATUS_LABELS[status] || BANK_STATUS_LABELS['unknown'];
  }

  countryName(code: string | null): string {
    if (!code) return '';
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
    } catch {
      return code;
    }
  }

  allowed(capability: string): boolean {
    const value = this.context?.capabilities[capability];
    return !!value?.allowed && !!value.enabled;
  }

  /** The direct debit permission is missing or switched off, which the request button fixes. */
  get canRequestPermission(): boolean {
    const value = this.context?.capabilities['receiveFromTransferInstrument'];
    return !value?.requested || !value.enabled;
  }

  capabilityStatus(capability: string): string {
    const value = this.context?.capabilities[capability];
    if (value?.allowed && value.enabled) return 'Allowed';
    if (value?.requested && !value.enabled) return 'Not enabled';
    if (value?.verificationStatus === 'pending') return 'Verification in progress';
    if (value?.verificationStatus === 'invalid' || value?.verificationStatus === 'rejected') return 'Action required';
    return value?.requested ? 'Requested' : 'Not requested';
  }

  selectBank(account: TopUpBankAccount) {
    if (!this.selectable(account) || this.bank.value === account.transferInstrumentId) return;
    this.bank.setValue(account.transferInstrumentId);
    this.authorization.reset();
  }

  bankAccount(id: string | null): TopUpBankAccount | undefined {
    return this.bankAccounts.find(a => a.transferInstrumentId === id);
  }

  frequency(schedule: string | null): string {
    return ({ weekly: 'every Monday', monthly: 'on the 1st of every month', daily: 'every day',
      balance: 'whenever the balance changes', cron: 'on a custom schedule' } as Record<string, string>)[schedule || '']
      || 'on an unknown schedule';
  }

  async requestCapability() {
    if (this.busy) return;
    const userId = this.userId;
    this.busy = true;
    this.error = '';
    try {
      const capabilities = await firstValueFrom(this.api.requestCapability(userId));
      if (!this.isCurrent(userId)) return;
      if (this.context) this.context.capabilities = capabilities;
      this.notify.success(this.allowed('receiveFromTransferInstrument')
        ? 'Direct debit top-ups enabled.' : 'Direct debit permission requested. Verification may be required.');
    } catch (error) {
      this.error = httpErrorMessage(error, 'The permission could not be requested. Try again.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  submit() {
    if (this.busy || this.blockReason || !this.context) return;
    void (this.recurring ? this.createSweep() : this.topUp());
  }

  private async topUp() {
    const context = this.context!;
    const userId = this.userId;
    const bank = this.selectedBank!;
    const amount = this.validMinorAmount()!;
    this.busy = true;
    this.error = '';
    try {
      const accepted = await this.confirm.confirm({
        title: 'Confirm top-up',
        message: 'Your bank account will be debited once. Funds usually arrive within a few business days.',
        details: [{ label: 'Amount', value: formatMoney(amount, context.currency) },
          { label: 'From', value: bank.accountNumber }],
        confirmText: 'Top up'
      });
      if (!accepted || !this.isCurrent(userId)) return;
      this.result = undefined;
      const result = await firstValueFrom(this.api.topUp(userId, {
        amount, transferInstrumentId: bank.transferInstrumentId, mandateAccepted: true
      }));
      if (this.isCurrent(userId)) this.result = result;
    } catch (error) {
      this.error = httpErrorMessage(error, 'The top-up could not be confirmed. Check Bank transactions before trying again.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  private async createSweep() {
    const context = this.context!;
    const userId = this.userId;
    const bank = this.selectedBank!;
    const amount = this.validMinorAmount()!;
    const schedule = this.form.controls.schedule.value;
    this.busy = true;
    this.error = '';
    try {
      if (!await this.confirm.confirm({
        title: `Schedule a ${schedule} top-up`,
        message: 'Your bank account will be debited on every collection date until you pause or delete this top-up.',
        details: [{ label: 'Amount', value: formatMoney(amount, context.currency) },
          { label: 'When', value: this.capitalize(this.frequency(schedule)) },
          { label: 'From', value: bank.accountNumber }],
        confirmText: 'Schedule top-up'
      })) return;
      if (!this.isCurrent(userId)) return;
      const sweep = await firstValueFrom(this.api.createSweep(userId, {
        transferInstrumentId: bank.transferInstrumentId, amount, schedule
      }));
      if (!this.isCurrent(userId) || !this.context) return;
      this.context.sweeps = [...this.context.sweeps, sweep];
      this.notify.success('Recurring top-up scheduled.');
    } catch (error) {
      this.error = httpErrorMessage(error, 'The recurring top-up could not be scheduled.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async toggle(sweep: TopUpSweep) {
    if (this.busy) return;
    const userId = this.userId;
    this.busy = true;
    this.error = '';
    try {
      const updated = await firstValueFrom(this.api.updateSweep(userId, sweep.id, sweep.status !== 'active'));
      if (!this.isCurrent(userId)) return;
      if (this.context) this.context.sweeps = this.context.sweeps.map(s => s.id === updated.id ? updated : s);
      this.notify.success(updated.status === 'active' ? 'Recurring top-up resumed.' : 'Recurring top-up paused.');
    } catch (error) {
      this.error = httpErrorMessage(error, 'The recurring top-up could not be updated.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async deleteSweep(sweep: TopUpSweep) {
    if (this.busy) return;
    const userId = this.userId;
    this.busy = true;
    this.error = '';
    try {
      if (!await this.confirm.confirm({
        title: 'Delete recurring top-up?', message: 'No further collections will be made for this top-up.',
        details: [{ label: 'Amount', value: formatMoney(sweep.amount, sweep.currency) },
          { label: 'When', value: this.capitalize(this.frequency(sweep.schedule)) }],
        confirmText: 'Delete', danger: true
      })) return;
      if (!this.isCurrent(userId)) return;
      await firstValueFrom(this.api.deleteSweep(userId, sweep.id));
      if (!this.isCurrent(userId)) return;
      if (this.context) this.context.sweeps = this.context.sweeps.filter(s => s.id !== sweep.id);
      this.notify.success('Recurring top-up deleted.');
    } catch (error) {
      this.error = httpErrorMessage(error, 'The recurring top-up could not be deleted.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  trackSweep(_: number, sweep: TopUpSweep): string {
    return sweep.id;
  }

  trackBank(_: number, account: TopUpBankAccount): string {
    return account.transferInstrumentId;
  }

  private validMinorAmount(): number | null {
    const value = this.form.controls.amount.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const minor = toMinorUnits(value, this.context?.currency);
    return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
  }

  private capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private isCurrent(userId: string): boolean {
    return !this.destroyed && this.userId === userId;
  }
}
