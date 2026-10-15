import {Component, signal, inject, OnDestroy, OnInit, DestroyRef, NgZone} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {FormBuilder, FormGroup, FormGroupDirective, ReactiveFormsModule, Validators, FormsModule} from '@angular/forms';
import {CommonModule} from '@angular/common';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {BalanceAccount, BalanceInfo, PayoutAccount, SweepInfo} from '../models';
import {AccountService, PayoutService, CashManagementService} from '../services';
import {ConfirmDialogDetail, ConfirmService, MoneyPipe, currencyExponent, formatMoney, httpErrorMessage, httpStatus, toMinorUnits} from '../shared';
import {describeSchedule} from '../banktransfer/schedule-label';

type AccountsState = 'loading' | 'ready' | 'missing' | 'error';

interface Recap {
    title: string;
    message: string;
    rows: ConfirmDialogDetail[];
}

const BUSINESS_BANK_ACCOUNT = 'Business Bank Account';
const DEFAULT_PAYOUT_CURRENCIES = ['EUR', 'GBP', 'USD'];
const PAYOUT_FREQUENCY_LABELS: Record<string, string> = {daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly'};

@Component({
    selector: 'app-cash-management',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        RouterLink,
        MaterialModule,
        MoneyPipe
    ],
    templateUrl: './cash-management.component.html',
    styleUrl: './cash-management.component.css'
})
export class CashManagementComponent implements OnInit, OnDestroy {
    userId = '';
    activeTab = 0;

    // Balance accounts
    readonly balanceAccounts = signal<BalanceAccount[]>([]);
    accountsState: AccountsState = 'loading';
    accountsError = '';
    lastUpdated: number | null = null;
    showCreateForm = false;
    newAccountDescription = '';
    creatingAccount = false;
    createError = '';
    togglingSweepId: string | null = null;

    // Internal transfer
    transferForm: FormGroup;
    submittingTransfer = false;
    availableCurrencies: string[] = [];
    transferRecap: Recap | null = null;

    // Payout
    payoutForm: FormGroup;
    submittingPayout = false;
    readonly payoutAccounts = signal<PayoutAccount[]>([]);
    loadingPayoutAccounts = false;
    payoutAccountsError = '';
    payoutCurrencies: string[] = DEFAULT_PAYOUT_CURRENCIES;
    payoutRecap: Recap | null = null;

    // Cashout
    cashoutForm: FormGroup;
    submittingCashout = false;
    cashoutPendingBalance = 0;
    cashoutCurrency = '';
    userCurrency = '';
    userCurrencyError = '';
    instantAvailable: boolean | null = null;
    checkingInstant = false;
    cashoutRecap: Recap | null = null;

    // Cashout cooldown
    cashoutCooldownRemaining = 0;
    private cashoutCooldownTimer: ReturnType<typeof setInterval> | null = null;

    readonly CASHOUT_FEE_RATE = 0.05;

    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private accountService = inject(AccountService);
    private payoutService = inject(PayoutService);
    private cashManagementService = inject(CashManagementService);
    private confirmService = inject(ConfirmService);
    private snackBar = inject(MatSnackBar);
    private destroyRef = inject(DestroyRef);
    private zone = inject(NgZone);

    constructor() {
        this.transferForm = this.fb.group({
            sourceBalanceAccountId: ['', Validators.required],
            destinationBalanceAccountId: ['', Validators.required],
            currency: ['', Validators.required],
            amount: [null, [Validators.required, Validators.min(0.01)]],
            description: ['']
        });

        this.payoutForm = this.fb.group({
            balanceAccountId: ['', Validators.required],
            currencyCode: ['', Validators.required],
            transferInstrumentId: ['', Validators.required],
            schedule: ['', Validators.required],
            priority: ['regular', Validators.required]
        });

        this.cashoutForm = this.fb.group({
            balanceAccountId: ['', Validators.required],
            currency: ['', Validators.required],
            amount: [null, [Validators.required, Validators.min(0.01)]],
            transferInstrumentId: [''],
            description: ['']
        });
    }

    ngOnInit() {
        this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.loadBalanceAccounts();
                this.loadPayoutAccounts();
                this.loadUserCurrency();
            }
        });

        this.transferForm.get('sourceBalanceAccountId')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.onSourceAccountChange();
        });

        this.transferForm.get('destinationBalanceAccountId')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.updateTransferCurrencies();
        });

        this.payoutForm.get('balanceAccountId')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(baId => {
            this.updatePayoutCurrencies(baId);
        });

        this.cashoutForm.get('balanceAccountId')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(baId => {
            this.onCashoutAccountChange(baId);
        });

        this.cashoutForm.get('transferInstrumentId')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(tiId => {
            this.onCashoutTransferInstrumentChange(tiId);
        });
    }

    // === Balance accounts ===

    get loadingAccounts(): boolean {
        return this.accountsState === 'loading';
    }

    loadBalanceAccounts(showSpinner = true) {
        if (showSpinner || this.accountsState !== 'ready') {
            this.accountsState = 'loading';
        }
        this.accountService.getBalanceAccounts(this.userId).subscribe({
            next: res => {
                this.balanceAccounts.set(res || []);
                this.lastUpdated = Date.now();
                this.accountsState = 'ready';
                this.refreshDerivedState();
            },
            error: err => {
                const status = httpStatus(err);
                const message = httpErrorMessage(err, 'We couldn\'t load your balance accounts.');
                // The backend answers 400 "User has no accountHolderId" until onboarding has created the account holder.
                this.accountsState = status === 404 || (status === 400 && /accountHolder/i.test(message)) ? 'missing' : 'error';
                this.accountsError = message;
            }
        });
    }

    refresh() {
        this.loadBalanceAccounts();
        this.loadPayoutAccounts();
        if (!this.userCurrency) {
            this.loadUserCurrency();
        }
    }

    getLastUpdatedLabel(): string {
        if (!this.lastUpdated) return '';
        const seconds = Math.floor((Date.now() - this.lastUpdated) / 1000);
        if (seconds < 60) return 'Updated just now';
        const minutes = Math.floor(seconds / 60);
        return `Updated ${minutes} min ago`;
    }

    toggleCreateForm() {
        this.showCreateForm = !this.showCreateForm;
        this.createError = '';
        if (!this.showCreateForm) {
            this.newAccountDescription = '';
        }
    }

    createBalanceAccount() {
        const description = this.newAccountDescription.trim();
        if (!description || this.creatingAccount) return;
        this.creatingAccount = true;
        this.createError = '';
        this.cashManagementService.createBalanceAccount(this.userId, description).subscribe({
            next: res => {
                this.balanceAccounts.set([...this.balanceAccounts(), res]);
                this.newAccountDescription = '';
                this.showCreateForm = false;
                this.creatingAccount = false;
                this.toastSuccess(`Balance account "${res.description || description}" created`);
            },
            error: err => {
                this.creatingAccount = false;
                this.createError = httpErrorMessage(err, 'We couldn\'t create the balance account. Try again.');
            }
        });
    }

    hasActiveSweeps(account: BalanceAccount): boolean {
        return !!account.sweeps?.some(s => s.status !== 'inactive');
    }

    accountName(account: BalanceAccount | undefined | null): string {
        if (!account) return '—';
        return account.description || account.balanceAccountId;
    }

    getTotalAvailable(account: BalanceAccount): string {
        if (!account.balances || account.balances.length === 0) return 'no balance';
        return account.balances.map(b => formatMoney(b.available, b.currency)).join(', ');
    }

    getSweepBeneficiary(sweep: SweepInfo): string {
        if (sweep.category === 'internal' && sweep.counterpartyBalanceAccountId) {
            const target = this.balanceAccounts().find(a => a.balanceAccountId === sweep.counterpartyBalanceAccountId);
            return target ? this.accountName(target) : sweep.counterpartyBalanceAccountId;
        }
        if (sweep.counterpartyTransferInstrumentId) {
            const bank = this.payoutAccounts().find(a => a.transferInstrumentId === sweep.counterpartyTransferInstrumentId);
            return bank ? bank.accountIdentifier : sweep.counterpartyTransferInstrumentId;
        }
        return '—';
    }

    getSweepScheduleLabel(sweep: SweepInfo): string {
        return describeSchedule(sweep.cronExpression || sweep.scheduleType);
    }

    getSweepPriorities(sweep: SweepInfo): string {
        return (sweep.priorities || []).map(p => this.capitalize(p)).join(', ');
    }

    async toggleSweep(account: BalanceAccount, sweep: SweepInfo) {
        if (this.togglingSweepId) return;
        const activate = sweep.status === 'inactive';
        if (!activate) {
            const confirmed = await this.confirmService.confirm({
                title: 'Suspend this payout schedule?',
                message: 'No automatic payouts will be made until you activate it again.',
                details: [
                    {label: 'Account', value: this.accountName(account)},
                    {label: 'Schedule', value: this.getSweepScheduleLabel(sweep)},
                    {label: 'Beneficiary', value: this.getSweepBeneficiary(sweep)}
                ],
                confirmText: 'Suspend',
                danger: true
            });
            if (!confirmed) return;
        }
        this.togglingSweepId = sweep.id;
        this.cashManagementService.updateSweepStatus(this.userId, account.balanceAccountId, sweep.id, activate).subscribe({
            next: () => {
                this.togglingSweepId = null;
                this.toastSuccess(activate ? 'Payout schedule activated' : 'Payout schedule suspended');
                this.loadBalanceAccounts(false);
            },
            error: err => {
                this.togglingSweepId = null;
                this.toastError(httpErrorMessage(err, 'We couldn\'t update the payout schedule. Try again.'));
            }
        });
    }

    // === Internal transfer ===

    isBusinessBankAccount(account: BalanceAccount | undefined | null): boolean {
        return account?.description === BUSINESS_BANK_ACCOUNT;
    }

    private findAccount(baId: string | null | undefined): BalanceAccount | undefined {
        return baId ? this.balanceAccounts().find(a => a.balanceAccountId === baId) : undefined;
    }

    private findBalance(account: BalanceAccount | undefined, currency: string | null | undefined): BalanceInfo | undefined {
        return currency ? account?.balances?.find(b => b.currency === currency) : undefined;
    }

    onSourceAccountChange() {
        this.transferForm.patchValue({currency: '', destinationBalanceAccountId: ''}, {emitEvent: false});
        this.updateTransferCurrencies();
    }

    updateTransferCurrencies() {
        const source = this.findAccount(this.transferForm.get('sourceBalanceAccountId')?.value);
        const dest = this.findAccount(this.transferForm.get('destinationBalanceAccountId')?.value);

        if (!source?.balances) {
            this.availableCurrencies = [];
            return;
        }

        let currencies = source.balances.map(b => b.currency);

        if (this.isBusinessBankAccount(source)) {
            currencies = [source.currencyCode];
        }
        if (dest && this.isBusinessBankAccount(dest)) {
            currencies = currencies.filter(c => c === dest.currencyCode);
        }

        this.availableCurrencies = currencies;
        if (currencies.length === 1) {
            this.transferForm.patchValue({currency: currencies[0]});
        } else if (!currencies.includes(this.transferForm.get('currency')?.value)) {
            this.transferForm.patchValue({currency: ''});
        }
    }

    getTransferDestinations(): BalanceAccount[] {
        const sourceId = this.transferForm.get('sourceBalanceAccountId')?.value;
        return this.balanceAccounts().filter(a => a.balanceAccountId !== sourceId);
    }

    get transferSourceBalance(): BalanceInfo | undefined {
        const source = this.findAccount(this.transferForm.get('sourceBalanceAccountId')?.value);
        return this.findBalance(source, this.transferForm.get('currency')?.value);
    }

    get transferAmountMinor(): number {
        return this.amountMinor(this.transferForm, 'currency');
    }

    get transferBlockReason(): string | null {
        const v = this.transferForm.value;
        if (!v.sourceBalanceAccountId) return 'Select the account to transfer from.';
        if (!v.destinationBalanceAccountId) return 'Select the account to transfer to.';
        if (!this.availableCurrencies.length) return 'These two accounts have no currency in common.';
        if (!v.currency) return 'Select a currency.';
        const amountReason = this.amountBlockReason(this.transferForm, v.currency);
        if (amountReason) return amountReason;
        const balance = this.transferSourceBalance;
        if (!balance || this.transferAmountMinor > balance.available) {
            return `The amount is more than the available balance (${formatMoney(balance?.available ?? 0, v.currency)}).`;
        }
        return null;
    }

    async submitTransfer(formDir: FormGroupDirective) {
        if (this.transferBlockReason || this.submittingTransfer) return;
        const val = this.transferForm.value;
        const source = this.findAccount(val.sourceBalanceAccountId);
        const dest = this.findAccount(val.destinationBalanceAccountId);
        const amount = this.transferAmountMinor;
        const rows: ConfirmDialogDetail[] = [
            {label: 'Amount', value: formatMoney(amount, val.currency)},
            {label: 'From', value: this.accountName(source)},
            {label: 'To', value: this.accountName(dest)}
        ];
        if (val.description?.trim()) {
            rows.push({label: 'Description', value: val.description.trim()});
        }

        const confirmed = await this.confirmService.confirm({
            title: 'Confirm transfer',
            message: 'Funds move between your balance accounts straight away.',
            details: rows,
            confirmText: 'Transfer funds'
        });
        if (!confirmed) return;

        this.submittingTransfer = true;
        this.cashManagementService.internalTransfer({
            userId: this.userId,
            sourceBalanceAccountId: val.sourceBalanceAccountId,
            destinationBalanceAccountId: val.destinationBalanceAccountId,
            currency: val.currency,
            amount,
            description: val.description?.trim() || undefined
        }).subscribe({
            next: () => {
                this.submittingTransfer = false;
                this.transferRecap = {
                    title: 'Transfer initiated',
                    message: 'The balances update once the transfer is booked.',
                    rows
                };
                formDir.resetForm({sourceBalanceAccountId: '', destinationBalanceAccountId: '', currency: '', amount: null, description: ''});
                this.availableCurrencies = [];
                this.loadBalanceAccounts(false);
            },
            error: err => {
                this.submittingTransfer = false;
                this.toastError(httpErrorMessage(err, 'The transfer failed. Try again.'));
            }
        });
    }

    // === Payouts ===

    getPayoutEligibleAccounts(): BalanceAccount[] {
        return this.balanceAccounts().filter(a => !this.isBusinessBankAccount(a));
    }

    loadPayoutAccounts() {
        this.loadingPayoutAccounts = true;
        this.payoutAccountsError = '';
        this.payoutService.getPayoutAccounts(this.userId).subscribe({
            next: res => {
                this.payoutAccounts.set(res || []);
                this.loadingPayoutAccounts = false;
            },
            error: err => {
                this.loadingPayoutAccounts = false;
                this.payoutAccountsError = httpErrorMessage(err, 'We couldn\'t load your payout bank accounts.');
            }
        });
    }

    payoutAccountLabel(transferInstrumentId: string | null | undefined): string {
        if (!transferInstrumentId) return 'Keep on balance account';
        return this.payoutAccounts().find(a => a.transferInstrumentId === transferInstrumentId)?.accountIdentifier || transferInstrumentId;
    }

    private updatePayoutCurrencies(baId: string | null | undefined) {
        const account = this.findAccount(baId);
        const currencies = account?.balances?.length
            ? Array.from(new Set(account.balances.map(b => b.currency)))
            : account?.currencyCode ? [account.currencyCode] : DEFAULT_PAYOUT_CURRENCIES;
        this.payoutCurrencies = currencies;
        const current = this.payoutForm.get('currencyCode')?.value;
        if (currencies.length === 1) {
            this.payoutForm.patchValue({currencyCode: currencies[0]});
        } else if (current && !currencies.includes(current)) {
            this.payoutForm.patchValue({currencyCode: ''});
        }
    }

    get payoutBlockReason(): string | null {
        const v = this.payoutForm.value;
        if (!v.balanceAccountId) return 'Select the balance account to pay out from.';
        if (!v.currencyCode) return 'Select a currency.';
        if (!v.transferInstrumentId) {
            return this.payoutAccounts().length ? 'Select the bank account to receive the payouts.' : 'You need a payout bank account first.';
        }
        if (!v.schedule) return 'Select how often to pay out.';
        return null;
    }

    async submitPayout(formDir: FormGroupDirective) {
        if (this.payoutBlockReason || this.submittingPayout) return;
        const val = this.payoutForm.value;
        const rows: ConfirmDialogDetail[] = [
            {label: 'From', value: this.accountName(this.findAccount(val.balanceAccountId))},
            {label: 'To', value: this.payoutAccountLabel(val.transferInstrumentId)},
            {label: 'Currency', value: val.currencyCode},
            {label: 'Frequency', value: PAYOUT_FREQUENCY_LABELS[val.schedule] || val.schedule},
            {label: 'Speed', value: this.capitalize(val.priority)}
        ];

        const confirmed = await this.confirmService.confirm({
            title: 'Create payout schedule?',
            message: 'The full available balance in this currency is paid out automatically at each run.',
            details: rows,
            confirmText: 'Create schedule'
        });
        if (!confirmed) return;

        this.submittingPayout = true;
        this.payoutService.createPayoutConfiguration({
            userId: this.userId,
            balanceAccountId: val.balanceAccountId,
            currencyCode: val.currencyCode,
            regular: val.priority === 'regular',
            instant: val.priority === 'instant',
            transferInstrumentId: val.transferInstrumentId,
            schedule: val.schedule
        }).subscribe({
            next: () => {
                this.submittingPayout = false;
                this.payoutRecap = {
                    title: 'Payout schedule created',
                    message: 'It now appears under the balance account above. You can suspend it at any time.',
                    rows
                };
                formDir.resetForm({balanceAccountId: '', currencyCode: '', transferInstrumentId: '', schedule: '', priority: 'regular'});
                this.payoutCurrencies = DEFAULT_PAYOUT_CURRENCIES;
                this.loadBalanceAccounts(false);
            },
            error: err => {
                this.submittingPayout = false;
                this.toastError(httpErrorMessage(err, 'We couldn\'t create the payout schedule. Try again.'));
            }
        });
    }

    // === Cashout ===

    get cashoutSelectedCurrency(): string {
        return this.cashoutForm.get('currency')?.value || '';
    }

    get cashoutAmountMinor(): number {
        return this.amountMinor(this.cashoutForm, 'currency');
    }

    // Same rounding as the backend (CashManagementService.executeCashout).
    get cashoutFeeMinor(): number {
        return Math.round(this.cashoutAmountMinor * this.CASHOUT_FEE_RATE);
    }

    get cashoutTotalMinor(): number {
        return this.cashoutAmountMinor + this.cashoutFeeMinor;
    }

    get cashoutBlockReason(): string | null {
        const v = this.cashoutForm.value;
        if (this.cashoutCooldownRemaining > 0) return `Wait ${this.cashoutCooldownRemaining}s before the next cash out.`;
        if (!this.cashoutSelectedCurrency) {
            return this.userCurrencyError || 'Loading your account currency...';
        }
        if (!v.balanceAccountId) return 'Select the balance account to cash out from.';
        if (this.cashoutPendingBalance <= 0) return 'There are no pending funds to cash out on this account.';
        const amountReason = this.amountBlockReason(this.cashoutForm, this.cashoutSelectedCurrency);
        if (amountReason) return amountReason;
        if (this.cashoutAmountMinor > this.cashoutPendingBalance) {
            return `The amount is more than the pending balance (${formatMoney(this.cashoutPendingBalance, this.cashoutCurrency)}).`;
        }
        if (this.checkingInstant) return 'Checking whether this bank account accepts instant payouts...';
        if (this.instantAvailable === false) return 'Choose another bank account or keep the funds on your balance account.';
        return null;
    }

    loadUserCurrency() {
        this.userCurrencyError = '';
        this.accountService.getUserById(this.userId).subscribe({
            next: user => {
                this.userCurrency = user.currencyCode;
                this.cashoutForm.patchValue({currency: this.userCurrency});
                this.onCashoutAccountChange(this.cashoutForm.get('balanceAccountId')?.value);
            },
            error: err => {
                this.userCurrencyError = httpErrorMessage(err, 'We couldn\'t load your account currency. Refresh the page to try again.');
            }
        });
    }

    onCashoutTransferInstrumentChange(transferInstrumentId: string) {
        this.instantAvailable = null;
        if (!transferInstrumentId) {
            this.checkingInstant = false;
            return;
        }
        const baId = this.cashoutForm.get('balanceAccountId')?.value;
        if (!baId || !this.userCurrency) return;

        this.checkingInstant = true;
        this.cashManagementService.checkInstantEligibility(baId, transferInstrumentId, this.userCurrency).subscribe({
            next: res => {
                if (this.cashoutForm.get('transferInstrumentId')?.value !== transferInstrumentId) return;
                this.instantAvailable = res.instantAvailable;
                this.checkingInstant = false;
            },
            error: () => {
                if (this.cashoutForm.get('transferInstrumentId')?.value !== transferInstrumentId) return;
                this.instantAvailable = false;
                this.checkingInstant = false;
            }
        });
    }

    onCashoutAccountChange(baId: string | null | undefined) {
        const account = this.findAccount(baId);
        this.cashoutCurrency = this.userCurrency;
        this.cashoutPendingBalance = this.findBalance(account, this.userCurrency)?.pending ?? 0;
        const tiId = this.cashoutForm.get('transferInstrumentId')?.value;
        if (tiId) {
            this.onCashoutTransferInstrumentChange(tiId);
        }
    }

    async submitCashout(formDir: FormGroupDirective) {
        if (this.cashoutBlockReason || this.submittingCashout) return;
        const val = this.cashoutForm.value;
        const currency = this.cashoutSelectedCurrency;
        const rows: ConfirmDialogDetail[] = [
            {label: 'Amount', value: formatMoney(this.cashoutAmountMinor, currency)},
            {label: `Fee (${this.CASHOUT_FEE_RATE * 100}%)`, value: formatMoney(this.cashoutFeeMinor, currency)},
            {label: 'Total debited', value: formatMoney(this.cashoutTotalMinor, currency)},
            {label: 'From', value: this.accountName(this.findAccount(val.balanceAccountId))},
            {label: 'Destination', value: this.payoutAccountLabel(val.transferInstrumentId)}
        ];

        const confirmed = await this.confirmService.confirm({
            title: 'Confirm cash out',
            message: 'The fee is charged on top of the amount you cash out.',
            details: rows,
            confirmText: 'Cash out'
        });
        if (!confirmed) return;

        this.submittingCashout = true;
        this.cashManagementService.cashout({
            userId: this.userId,
            balanceAccountId: val.balanceAccountId,
            currency,
            amount: this.cashoutAmountMinor,
            transferInstrumentId: val.transferInstrumentId || undefined,
            description: val.transferInstrumentId ? (val.description?.trim() || undefined) : undefined
        }).subscribe({
            next: (res: { cooldownSeconds?: number } | null) => {
                this.submittingCashout = false;
                this.cashoutRecap = {
                    title: 'Cash out requested',
                    message: val.transferInstrumentId
                        ? 'The funds are on their way to your bank account.'
                        : 'The funds will be available on your balance account shortly.',
                    rows
                };
                formDir.resetForm({balanceAccountId: '', currency: this.userCurrency, amount: null, transferInstrumentId: '', description: ''});
                this.startCooldownTimer(res?.cooldownSeconds || 30);
                this.loadBalanceAccounts(false);
            },
            error: err => {
                this.submittingCashout = false;
                const msg = httpErrorMessage(err, 'The cash out request failed. Try again.');
                this.toastError(msg);
                const match = msg.match(/(\d+) seconds/);
                if (match) {
                    this.startCooldownTimer(parseInt(match[1], 10));
                }
            }
        });
    }

    startCooldownTimer(seconds: number) {
        this.clearCooldownTimer();
        this.cashoutCooldownRemaining = seconds;
        this.zone.runOutsideAngular(() => {
            this.cashoutCooldownTimer = setInterval(() => {
                this.zone.run(() => {
                    this.cashoutCooldownRemaining--;
                    if (this.cashoutCooldownRemaining <= 0) {
                        this.clearCooldownTimer();
                    }
                });
            }, 1000);
        });
    }

    private clearCooldownTimer() {
        if (this.cashoutCooldownTimer) {
            clearInterval(this.cashoutCooldownTimer);
            this.cashoutCooldownTimer = null;
        }
        this.cashoutCooldownRemaining = 0;
    }

    ngOnDestroy() {
        this.clearCooldownTimer();
    }

    // === Helpers ===

    amountStep(currency: string | null | undefined): string {
        const exponent = currencyExponent(currency);
        return exponent === 0 ? '1' : (1 / Math.pow(10, exponent)).toFixed(exponent);
    }

    private amountMinor(form: FormGroup, currencyControl: string): number {
        const amount = Number(form.get('amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        return toMinorUnits(amount, form.get(currencyControl)?.value);
    }

    private amountBlockReason(form: FormGroup, currency: string): string | null {
        const raw = form.get('amount')?.value;
        if (raw === null || raw === undefined || raw === '') return 'Enter an amount.';
        const amount = Number(raw);
        if (!Number.isFinite(amount) || toMinorUnits(amount, currency) < 1) {
            return `Enter an amount of at least ${formatMoney(1, currency)}.`;
        }
        return null;
    }

    private refreshDerivedState() {
        this.updateTransferCurrencies();
        this.onCashoutAccountChange(this.cashoutForm.get('balanceAccountId')?.value);
    }

    private capitalize(value: string | null | undefined): string {
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
    }

    private toastSuccess(message: string) {
        this.snackBar.open(message, 'Close', {duration: 3000, panelClass: 'fintech-snack-success'});
    }

    private toastError(message: string) {
        this.snackBar.open(message, 'Close', {duration: 6000, panelClass: 'fintech-snack-error'});
    }
}
