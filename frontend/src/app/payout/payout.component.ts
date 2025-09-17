import {Component, signal, inject} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule} from '@angular/forms';
import {CommonModule, NgIf, NgFor} from "@angular/common";
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {MatButtonModule} from '@angular/material/button';
import {MatCardModule} from '@angular/material/card';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatSelectModule} from '@angular/material/select';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatTabsModule} from '@angular/material/tabs';
import {MyPlatformService, PayoutConfiguration, BalanceAccount, PayoutAccount} from "../my-platform-service";
import {AdyenPlatformExperience, PayoutsOverview} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {PayoutTypePipe} from "./payout-type-pipe";

@Component({
    selector: 'app-payout',
    standalone: true,
    imports: [
        CommonModule,
        NgIf, NgFor,
        ReactiveFormsModule,
        FormsModule,
        MatSnackBarModule,
        MatButtonModule,
        MatCardModule,
        MatFormFieldModule,
        MatSelectModule,
        MatCheckboxModule,
        MatProgressSpinnerModule,
        MatTabsModule,
        PayoutTypePipe
    ],
    template: `
  <div class="payout-container">

    <h1>Payout Configurations</h1>

    <!-- Balance Account Selector -->
    <mat-form-field appearance="outline" class="full-width">
      <mat-label>Select Balance Account</mat-label>
      <mat-select [(ngModel)]="selectedBalanceAccount" (selectionChange)="loadConfigurations()">
        <mat-option *ngFor="let acc of balanceAccounts()" [value]="acc.balanceAccountId">
          {{ acc.description }} {{ acc.currencyCode }}
        </mat-option>
      </mat-select>
    </mat-form-field>

    <!-- Tabs -->
    <mat-tab-group>
      <!-- Existing Configurations -->
      <mat-tab label="Existing Configurations">
        <div class="tab-content">
          <ng-container *ngIf="loadingConfigurations; else configsList">
            <div class="loading-container">
              <mat-progress-spinner diameter="40" mode="indeterminate"></mat-progress-spinner>
              <span>Loading configurations...</span>
            </div>
          </ng-container>

          <ng-template #configsList>
            <ng-container *ngIf="payoutConfigurations().length; else noConfigs">
              <mat-card *ngFor="let config of payoutConfigurations()" class="config-card">
                <div><strong>Currency:</strong> {{ config.currencyCode }}</div>
                <div><strong>Type:</strong> {{ config | payoutType }}</div>
                <div><strong>Schedule:</strong> {{ config.schedule }}</div>
                <div><strong>Payout Account:</strong> {{ config.accountIdentifier }}</div>
               </mat-card>
            </ng-container>
            <ng-template #noConfigs>
              <p>No payout configurations yet for this account.</p>
            </ng-template>
          </ng-template>
        </div>
      </mat-tab>

      <!-- Add New Configuration -->
      <mat-tab label="Add New Configuration">
        <div class="tab-content">
          <mat-card>
            <form [formGroup]="configForm" (ngSubmit)="addConfiguration()">
              
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Currency</mat-label>
                <mat-select formControlName="currencyCode">
                  <mat-option value="EUR">EUR</mat-option>
                  <mat-option value="GBP">GBP</mat-option>
                  <mat-option value="USD">USD</mat-option>
                </mat-select>
              </mat-form-field>

              <div class="checkbox-group">
                <mat-checkbox formControlName="regular">Regular</mat-checkbox>
                <mat-checkbox formControlName="instant">Instant</mat-checkbox>
              </div>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Schedule</mat-label>
                <mat-select formControlName="schedule">
                  <mat-option value="daily">Daily</mat-option>
                  <mat-option value="weekly">Weekly</mat-option>
                  <mat-option value="monthly">Monthly</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Payout Account</mat-label>
                <mat-select formControlName="transferInstrumentId">
                  <mat-option *ngFor="let acc of payoutAccounts()" [value]="acc.transferInstrumentId">
                    {{ acc.accountIdentifier }}
                  </mat-option>
                </mat-select>
              </mat-form-field>

              <button mat-raised-button color="primary" type="submit"
                [disabled]="configForm.invalid || submitting || (!configForm.value.regular && !configForm.value.instant)">
                Add Configuration
              </button>
            </form>
          </mat-card>
        </div>
      </mat-tab>
    </mat-tab-group>

    <!-- Adyen component -->
    <div id="adyen-component" class="main-container">
      <div id="payout-overview-container"></div>
    </div>

  </div>
  `,
    styles: [`
    .payout-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
    }
    .full-width { width: 100%; }
    .checkbox-group { display: flex; gap: 1rem; margin: 0.5rem 0; }
    .config-card {
      border: 1px solid #ddd;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      border-radius: 6px;
      background-color: #fafafa;
    }
    .tab-content { padding: 1rem 0; }
    .loading-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `]
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
    private authService = inject(MyPlatformService);
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
        this.authService.getBalanceAccounts(Number(this.userId)).subscribe({
            next: res => this.balanceAccounts.set(res),
            error: () => this.matSnackBar.open('Error loading balance accounts', 'Close', {duration: 3000})
        });
    }

    loadConfigurations() {
        if (!this.selectedBalanceAccount) return;
        this.loadingConfigurations = true;
        this.authService.getPayoutConfigurations(Number(this.userId), this.selectedBalanceAccount).subscribe({
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
        this.authService.getPayoutAccounts(Number(this.userId)).subscribe({
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

        this.authService.createPayoutConfiguration(payload).subscribe({
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
                const sessionToken = await this.authService.getPayoutInformation(this.userId).toPromise();
                if (!sessionToken) throw new Error('Impossible to get payout information');
                return { token: sessionToken.token, id: sessionToken.id };
            }
        });
        const payoutsOverview = new PayoutsOverview({core});
        payoutsOverview.mount('#payout-overview-container');
    }
}
