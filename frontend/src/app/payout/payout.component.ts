import {Component, signal, inject, OnInit, OnDestroy, ElementRef, ViewChild, DestroyRef} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute} from '@angular/router';
import {FormBuilder, FormGroup, FormGroupDirective, ReactiveFormsModule, Validators, FormsModule} from '@angular/forms';
import {CommonModule} from "@angular/common";
import {firstValueFrom} from 'rxjs';
import {MaterialModule} from '../material.module';
import {PayoutConfiguration, BalanceAccount, PayoutAccount} from "../models";
import {AccountService, PayoutService, SessionService} from "../services";
import {AdyenPlatformExperience, PayoutsOverview} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {PayoutTypePipe} from "./payout-type-pipe";
import {ConfirmService, InlineAlertComponent, NotifyService, httpErrorMessage} from '../shared';
import {describeSchedule} from '../banktransfer/schedule-label';

type LoadState = 'loading' | 'ready' | 'error';

const DEFAULT_CURRENCIES = ['EUR', 'GBP', 'USD'];
const BUSINESS_BANK_ACCOUNT = 'Business Bank Account';

@Component({
    selector: 'app-payout',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        MaterialModule,
        PayoutTypePipe,
        InlineAlertComponent
    ],
    templateUrl: './payout.component.html',
    styleUrl: './payout.component.css'
})
export class PayoutComponent implements OnInit, OnDestroy {
    @ViewChild('overviewContainer', {static: true}) overviewContainer!: ElementRef<HTMLElement>;

    userId = '';
    selectedBalanceAccount = '';
    submitting = false;
    submitError = '';

    accountsState: LoadState = 'loading';
    accountsError = '';
    configurationsState: LoadState = 'ready';
    configurationsError = '';
    payoutAccountsState: LoadState = 'loading';
    payoutAccountsError = '';
    overviewState: LoadState = 'loading';
    overviewError = '';

    readonly balanceAccounts = signal<BalanceAccount[]>([]);
    readonly payoutConfigurations = signal<PayoutConfiguration[]>([]);
    readonly payoutAccounts = signal<PayoutAccount[]>([]);

    configForm: FormGroup;

    private overview: PayoutsOverview | null = null;
    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private accountService = inject(AccountService);
    private payoutService = inject(PayoutService);
    private sessionService = inject(SessionService);
    private confirmService = inject(ConfirmService);
    private notify = inject(NotifyService);
    private destroyRef = inject(DestroyRef);

    constructor() {
        this.configForm = this.fb.group({
            currencyCode: ['', Validators.required],
            regular: [true],
            instant: [false],
            schedule: ['', Validators.required],
            transferInstrumentId: ['', Validators.required],
        });
        this.configForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.submitError = '');
    }

    ngOnInit() {
        this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.loadBalanceAccounts();
                this.loadPayoutAccounts();
                this.initAdyenComponents();
            }
        });
    }

    ngOnDestroy() {
        this.overview?.unmount();
        this.overview = null;
    }

    get selectedAccount(): BalanceAccount | undefined {
        return this.balanceAccounts().find(a => a.balanceAccountId === this.selectedBalanceAccount);
    }

    get eligibleAccounts(): BalanceAccount[] {
        return this.balanceAccounts().filter(a => a.description !== BUSINESS_BANK_ACCOUNT);
    }

    get currencies(): string[] {
        const account = this.selectedAccount;
        if (account?.balances?.length) return Array.from(new Set(account.balances.map(b => b.currency)));
        return account?.currencyCode ? [account.currencyCode] : DEFAULT_CURRENCIES;
    }

    get blockReason(): string | null {
        const v = this.configForm.value;
        if (!this.selectedBalanceAccount) return 'Select a balance account first.';
        if (!v.currencyCode) return 'Select a currency.';
        if (!v.regular && !v.instant) return 'Select at least one payout speed: regular or instant.';
        if (!v.schedule) return 'Select how often to pay out.';
        if (!v.transferInstrumentId) {
            return this.payoutAccounts().length ? 'Select the bank account to receive the payouts.' : 'You need a payout bank account first.';
        }
        return null;
    }

    scheduleLabel(schedule: string): string {
        return describeSchedule(schedule);
    }

    loadBalanceAccounts() {
        this.accountsState = 'loading';
        this.accountService.getBalanceAccounts(this.userId).subscribe({
            next: res => {
                this.balanceAccounts.set(res || []);
                this.accountsState = 'ready';
            },
            error: err => {
                this.accountsState = 'error';
                this.accountsError = httpErrorMessage(err, "The balance accounts couldn't be loaded. Try again.");
            }
        });
    }

    onBalanceAccountChange() {
        const currencies = this.currencies;
        const current = this.configForm.get('currencyCode')?.value;
        if (currencies.length === 1) {
            this.configForm.patchValue({currencyCode: currencies[0]});
        } else if (current && !currencies.includes(current)) {
            this.configForm.patchValue({currencyCode: ''});
        }
        this.loadConfigurations();
    }

    loadConfigurations() {
        if (!this.selectedBalanceAccount) return;
        const balanceAccountId = this.selectedBalanceAccount;
        this.configurationsState = 'loading';
        this.payoutService.getPayoutConfigurations(this.userId, balanceAccountId).subscribe({
            next: res => {
                if (balanceAccountId !== this.selectedBalanceAccount) return;
                this.payoutConfigurations.set(res || []);
                this.configurationsState = 'ready';
            },
            error: err => {
                if (balanceAccountId !== this.selectedBalanceAccount) return;
                this.configurationsState = 'error';
                this.configurationsError = httpErrorMessage(err, "The payout schedules of this account couldn't be loaded. Try again.");
            }
        });
    }

    loadPayoutAccounts() {
        this.payoutAccountsState = 'loading';
        this.payoutService.getPayoutAccounts(this.userId).subscribe({
            next: res => {
                this.payoutAccounts.set(res || []);
                this.payoutAccountsState = 'ready';
            },
            error: err => {
                this.payoutAccountsState = 'error';
                this.payoutAccountsError = httpErrorMessage(err, "The payout bank accounts couldn't be loaded. Try again.");
            }
        });
    }

    async addConfiguration(formDir: FormGroupDirective) {
        if (this.blockReason || this.submitting) return;
        const {currencyCode, regular, instant, schedule, transferInstrumentId} = this.configForm.value;
        const bank = this.payoutAccounts().find(a => a.transferInstrumentId === transferInstrumentId);

        const confirmed = await this.confirmService.confirm({
            title: 'Create this payout schedule?',
            message: 'The available balance in this currency is paid out automatically to the bank account at each run.',
            details: [
                {label: 'Balance account', value: this.selectedAccount?.description || this.selectedBalanceAccount},
                {label: 'Currency', value: currencyCode},
                {label: 'Frequency', value: this.scheduleLabel(schedule)},
                {label: 'Speed', value: [regular ? 'Regular' : '', instant ? 'Instant' : ''].filter(Boolean).join(', ')},
                {label: 'Payout bank account', value: bank?.accountIdentifier || transferInstrumentId}
            ],
            confirmText: 'Create schedule',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        this.submitting = true;
        this.submitError = '';
        this.payoutService.createPayoutConfiguration({
            userId: this.userId,
            balanceAccountId: this.selectedBalanceAccount,
            currencyCode,
            regular,
            instant,
            schedule,
            transferInstrumentId
        }).subscribe({
            next: res => {
                this.payoutConfigurations.set([...this.payoutConfigurations(), res]);
                this.notify.success('Payout schedule created');
                formDir.resetForm({currencyCode: '', regular: true, instant: false, schedule: '', transferInstrumentId: ''});
                this.submitting = false;
            },
            error: err => {
                this.submitting = false;
                this.submitError = httpErrorMessage(err, "The payout schedule couldn't be created. Check the details and try again.");
            }
        });
    }

    async initAdyenComponents() {
        this.overviewState = 'loading';
        this.overviewError = '';
        this.overview?.unmount();
        this.overview = null;
        try {
            const core = await AdyenPlatformExperience({
                onSessionCreate: async () => {
                    const sessionToken = await firstValueFrom(this.sessionService.getPayoutInformation(this.userId));
                    if (!sessionToken) throw new Error('Missing payout session');
                    return {token: sessionToken.token, id: sessionToken.id};
                }
            });
            this.overview = new PayoutsOverview({core});
            this.overview.mount(this.overviewContainer.nativeElement);
            this.overviewState = 'ready';
        } catch (err) {
            this.overviewState = 'error';
            this.overviewError = httpErrorMessage(err, "The payouts overview couldn't be loaded. Try again.");
        }
    }
}
