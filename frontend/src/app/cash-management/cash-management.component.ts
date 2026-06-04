import {Component, signal, inject} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule} from '@angular/forms';
import {CommonModule} from '@angular/common';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {BalanceAccount, BalanceInfo, PayoutAccount, PayoutConfiguration} from '../models';
import {AccountService, PayoutService, CashManagementService} from '../services';

@Component({
    selector: 'app-cash-management',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        MaterialModule
    ],
    templateUrl: './cash-management.component.html',
    styleUrl: './cash-management.component.css'
})
export class CashManagementComponent {
    userId = '';
    activeTab = 0;

    // Balance accounts
    readonly balanceAccounts = signal<BalanceAccount[]>([]);
    loadingAccounts = false;
    showCreateForm = false;
    newAccountDescription = '';
    creatingAccount = false;

    // Internal Transfer
    transferForm: FormGroup;
    submittingTransfer = false;
    availableCurrencies: string[] = [];

    // Payout
    payoutForm: FormGroup;
    submittingPayout = false;
    readonly payoutAccounts = signal<PayoutAccount[]>([]);
    loadingPayoutAccounts = false;

    // Cashout
    cashoutForm: FormGroup;
    submittingCashout = false;
    cashoutPendingBalance = 0;
    cashoutCurrency = '';

    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private accountService = inject(AccountService);
    private payoutService = inject(PayoutService);
    private cashManagementService = inject(CashManagementService);
    private snackBar = inject(MatSnackBar);

    constructor() {
        this.transferForm = this.fb.group({
            sourceBalanceAccountId: ['', Validators.required],
            destinationBalanceAccountId: ['', Validators.required],
            currency: ['', Validators.required],
            amount: [null, [Validators.required, Validators.min(1)]],
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
            amount: [null, [Validators.required, Validators.min(1)]],
            transferInstrumentId: ['', Validators.required],
            description: ['']
        });
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.loadBalanceAccounts();
                this.loadPayoutAccounts();
            }
        });

        this.transferForm.get('sourceBalanceAccountId')?.valueChanges.subscribe(baId => {
            this.onSourceAccountChange(baId);
        });

        this.transferForm.get('destinationBalanceAccountId')?.valueChanges.subscribe(() => {
            this.updateTransferCurrencies();
        });

        this.cashoutForm.get('balanceAccountId')?.valueChanges.subscribe(baId => {
            this.onCashoutAccountChange(baId);
        });
    }

    // === Balance Accounts ===

    loadBalanceAccounts() {
        this.loadingAccounts = true;
        this.accountService.getBalanceAccounts(this.userId).subscribe({
            next: res => {
                this.balanceAccounts.set(res);
                this.loadingAccounts = false;
            },
            error: () => {
                this.loadingAccounts = false;
                this.toast('Error loading balance accounts');
            }
        });
    }

    createBalanceAccount() {
        if (!this.newAccountDescription.trim()) return;
        this.creatingAccount = true;
        this.cashManagementService.createBalanceAccount(this.userId, this.newAccountDescription).subscribe({
            next: res => {
                this.balanceAccounts.set([...this.balanceAccounts(), res]);
                this.newAccountDescription = '';
                this.showCreateForm = false;
                this.creatingAccount = false;
                this.toast('Balance account created');
            },
            error: () => {
                this.creatingAccount = false;
                this.toast('Error creating balance account');
            }
        });
    }

    formatAmount(value: number, currency: string): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency', currency, minimumFractionDigits: 2
        }).format(value / 100);
    }

    hasActiveSweeps(account: BalanceAccount): boolean {
        return !!account.sweeps?.some(s => s.status !== 'inactive');
    }

    getTotalAvailable(account: BalanceAccount): string {
        if (!account.balances || account.balances.length === 0) return '—';
        return account.balances.map(b => this.formatAmount(b.available, b.currency)).join(', ');
    }

    getSweepBeneficiary(sweep: any): string {
        if (sweep.category === 'internal' && sweep.counterpartyBalanceAccountId) {
            const target = this.balanceAccounts().find(a => a.balanceAccountId === sweep.counterpartyBalanceAccountId);
            return target ? (target.description || target.balanceAccountId) : sweep.counterpartyBalanceAccountId;
        }
        if (sweep.counterpartyTransferInstrumentId) {
            return sweep.counterpartyTransferInstrumentId;
        }
        return '—';
    }

    getSweepScheduleLabel(sweep: any): string {
        if (sweep.cronExpression) {
            return `Cron: ${sweep.cronExpression}`;
        }
        return sweep.scheduleType ? sweep.scheduleType.charAt(0).toUpperCase() + sweep.scheduleType.slice(1) : '—';
    }

    toggleSweep(balanceAccountId: string, sweepId: string, currentStatus: string) {
        const activate = currentStatus === 'inactive';
        this.cashManagementService.updateSweepStatus(this.userId, balanceAccountId, sweepId, activate).subscribe({
            next: () => {
                this.toast(activate ? 'Payout schedule activated' : 'Payout schedule suspended');
                this.loadBalanceAccounts();
            },
            error: () => this.toast('Failed to update payout schedule')
        });
    }

    // === Internal Transfer ===

    isBusinessBankAccount(account: BalanceAccount): boolean {
        return account.description === 'Business Bank Account';
    }

    onSourceAccountChange(baId: string) {
        this.transferForm.patchValue({currency: '', destinationBalanceAccountId: ''});
        this.updateTransferCurrencies();
    }

    updateTransferCurrencies() {
        const sourceId = this.transferForm.get('sourceBalanceAccountId')?.value;
        const destId = this.transferForm.get('destinationBalanceAccountId')?.value;
        const source = this.balanceAccounts().find(a => a.balanceAccountId === sourceId);
        const dest = destId ? this.balanceAccounts().find(a => a.balanceAccountId === destId) : null;

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

    submitTransfer() {
        if (this.transferForm.invalid) return;
        this.submittingTransfer = true;
        const val = this.transferForm.value;
        this.cashManagementService.internalTransfer({
            userId: this.userId,
            sourceBalanceAccountId: val.sourceBalanceAccountId,
            destinationBalanceAccountId: val.destinationBalanceAccountId,
            currency: val.currency,
            amount: Math.round(val.amount * 100),
            description: val.description || undefined
        }).subscribe({
            next: () => {
                this.toast('Transfer initiated successfully');
                this.transferForm.reset();
                this.submittingTransfer = false;
                this.loadBalanceAccounts();
            },
            error: () => {
                this.submittingTransfer = false;
                this.toast('Transfer failed');
            }
        });
    }

    // === Payouts ===

    getPayoutEligibleAccounts(): BalanceAccount[] {
        return this.balanceAccounts().filter(a => a.description !== 'Business Bank Account');
    }

    loadPayoutAccounts() {
        this.loadingPayoutAccounts = true;
        this.payoutService.getPayoutAccounts(this.userId).subscribe({
            next: res => {
                this.payoutAccounts.set(res);
                this.loadingPayoutAccounts = false;
            },
            error: () => {
                this.loadingPayoutAccounts = false;
                this.toast('Error loading payout accounts');
            }
        });
    }

    submitPayout() {
        if (this.payoutForm.invalid) return;
        this.submittingPayout = true;
        const val = this.payoutForm.value;
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
                this.toast('Payout schedule created');
                this.payoutForm.reset();
                this.submittingPayout = false;
                this.loadBalanceAccounts();
            },
            error: () => {
                this.submittingPayout = false;
                this.toast('Error creating payout schedule');
            }
        });
    }

    // === Cashout ===

    readonly CASHOUT_FEE_RATE = 0.05;

    get cashoutAmount(): number {
        return this.cashoutForm.get('amount')?.value || 0;
    }

    get cashoutFee(): number {
        return this.cashoutAmount * this.CASHOUT_FEE_RATE;
    }

    get cashoutTotal(): number {
        return this.cashoutAmount + this.cashoutFee;
    }

    get cashoutSelectedCurrency(): string {
        return this.cashoutForm.get('currency')?.value || '';
    }

    onCashoutAccountChange(baId: string) {
        const account = this.balanceAccounts().find(a => a.balanceAccountId === baId);
        if (account?.balances && account.balances.length > 0) {
            const first = account.balances[0];
            this.cashoutPendingBalance = first.pending;
            this.cashoutCurrency = first.currency;
            this.cashoutForm.patchValue({currency: first.currency});
        }
    }

    getCashoutCurrencies(): string[] {
        const baId = this.cashoutForm.get('balanceAccountId')?.value;
        const account = this.balanceAccounts().find(a => a.balanceAccountId === baId);
        return account?.balances?.map(b => b.currency) || [];
    }

    submitCashout() {
        if (this.cashoutForm.invalid) return;
        this.submittingCashout = true;
        const val = this.cashoutForm.value;
        this.cashManagementService.cashout({
            userId: this.userId,
            balanceAccountId: val.balanceAccountId,
            currency: val.currency,
            amount: Math.round(val.amount * 100),
            transferInstrumentId: val.transferInstrumentId,
            description: val.description || undefined
        }).subscribe({
            next: () => {
                this.toast('Cashout request submitted');
                this.cashoutForm.reset();
                this.submittingCashout = false;
                this.loadBalanceAccounts();
            },
            error: () => {
                this.submittingCashout = false;
                this.toast('Cashout request failed');
            }
        });
    }

    private toast(message: string) {
        this.snackBar.open(message, 'Close', {duration: 3000});
    }
}
