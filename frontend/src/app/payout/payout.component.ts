import {Component, signal, inject} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule} from '@angular/forms';
import {CommonModule} from "@angular/common";
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {PayoutConfiguration, BalanceAccount, PayoutAccount} from "../models";
import {AccountService, PayoutService, SessionService} from "../services";
import {AdyenPlatformExperience, PayoutsOverview} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {PayoutTypePipe} from "./payout-type-pipe";

@Component({
    selector: 'app-payout',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        MaterialModule,
        PayoutTypePipe
    ],
    templateUrl: './payout.component.html',
    styleUrl: './payout.component.css'
})
export class PayoutComponent {
    userId = '';
    selectedBalanceAccount: string | null = null;
    submitting = false;
    loadingConfigurations = false;

    readonly balanceAccounts = signal<BalanceAccount[]>([]);
    readonly payoutConfigurations = signal<PayoutConfiguration[]>([]);
    readonly payoutAccounts = signal<PayoutAccount[]>([]);

    configForm: FormGroup;

    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private accountService = inject(AccountService);
    private payoutService = inject(PayoutService);
    private sessionService = inject(SessionService);
    private matSnackBar = inject(MatSnackBar);

    constructor() {
        this.configForm = this.fb.group({
            currencyCode: ['', Validators.required],
            regular: [false],
            instant: [false],
            schedule: ['', Validators.required],
            transferInstrumentId: ['', Validators.required],
        });
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.loadBalanceAccounts();
                this.loadPayoutAccounts();
                this.initAdyenComponents();
            }
        });
    }

    loadBalanceAccounts() {
        this.accountService.getBalanceAccounts(Number(this.userId)).subscribe({
            next: res => this.balanceAccounts.set(res),
            error: () => this.matSnackBar.open('Error loading balance accounts', 'Close', {duration: 3000})
        });
    }

    loadConfigurations() {
        if (!this.selectedBalanceAccount) return;
        this.loadingConfigurations = true;
        this.payoutService.getPayoutConfigurations(Number(this.userId), this.selectedBalanceAccount).subscribe({
            next: res => {
                this.payoutConfigurations.set(res);
                this.loadingConfigurations = false;
            },
            error: () => {
                this.loadingConfigurations = false;
                this.matSnackBar.open('Error loading configurations', 'Close', {duration: 3000})
            }
        });
    }

    loadPayoutAccounts() {
        this.payoutService.getPayoutAccounts(Number(this.userId)).subscribe({
            next: res => this.payoutAccounts.set(res),
            error: () => this.matSnackBar.open('Error loading payout accounts', 'Close', {duration: 3000})
        });
    }

    addConfiguration() {
        if (!this.selectedBalanceAccount) {
            this.matSnackBar.open('Select a balance account first', 'Close', {duration: 3000});
            return;
        }

        if (this.configForm.invalid) return;
        const {currencyCode, regular, instant, schedule, transferInstrumentId} = this.configForm.value;
        if (!regular && !instant) {
            this.matSnackBar.open('Select at least one type: Regular or Instant', 'Close', {duration: 3000});
            return;
        }

        this.submitting = true;
        const payload = {
            userId: Number(this.userId),
            balanceAccountId: this.selectedBalanceAccount,
            currencyCode,
            regular,
            instant,
            schedule,
            transferInstrumentId
        };

        this.payoutService.createPayoutConfiguration(payload).subscribe({
            next: res => {
                this.payoutConfigurations.set([...this.payoutConfigurations(), res]);
                this.matSnackBar.open('Configuration added successfully', 'Close', {duration: 3000});
                this.configForm.reset({currencyCode: '', regular: false, instant: false, schedule: '', transferInstrumentId: ''});
                this.submitting = false;
            },
            error: () => {
                this.matSnackBar.open('Error adding configuration', 'Close', {duration: 3000});
                this.submitting = false;
            }
        });
    }

    private async initAdyenComponents() {
        const core = await AdyenPlatformExperience({
            onSessionCreate: async () => {
                const sessionToken = await this.sessionService.getPayoutInformation(this.userId).toPromise();
                if (!sessionToken) throw new Error('Impossible to get payout information');
                return { token: sessionToken.token, id: sessionToken.id };
            }
        });
        const payoutsOverview = new PayoutsOverview({core});
        payoutsOverview.mount('#payout-overview-container');
    }
}
