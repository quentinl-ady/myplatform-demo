import {Component, signal, inject} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {MatButtonModule} from '@angular/material/button';
import {MatCardModule} from '@angular/material/card';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatSelectModule} from '@angular/material/select';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatInputModule} from '@angular/material/input';
import {MatBadgeModule} from '@angular/material/badge';
import {CommonModule} from "@angular/common";
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MyPlatformService, OnboardingPart, OnboardingResponse, User} from "../my-platform-service";
import {MaterialModule} from "../material.module";
import {INDUSTRY_CODES} from "../industry-codes";

export interface BusinessLine {
    id: string;
    industryCode: string;
    salesChannels: string[];
}

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [
        CommonModule,
        MaterialModule,
        ReactiveFormsModule,
        MatSnackBarModule,
        MatButtonModule,
        MatCardModule,
        MatProgressSpinnerModule,
        MatFormFieldModule,
        MatSelectModule,
        MatCheckboxModule,
        MatInputModule,
        MatBadgeModule
    ],
    template: `
  <div class="dashboard-container">
    <h1>Onboarding</h1>

    <div class="button-group">
      <button mat-raised-button color="primary" (click)="openHostedOnboarding()">
        Go to Onboarding
      </button>
      <button mat-flat-button color="accent" (click)="checkOnboarding()">
        Check Onboarding Status
      </button>
    </div>

    <div class="loading-container" *ngIf="loading()">
      <mat-progress-spinner mode="indeterminate" diameter="40"></mat-progress-spinner>
      <span>Loading...</span>
    </div>

    <mat-card *ngIf="status() as s" class="status-card">
      <ng-container *ngIf="allValid(s); else details">
        ✅ All services are validated. You can now use the platform without restrictions.
      </ng-container>

      <ng-template #details>
        <ul>
          <li>
            <strong>Acquiring:</strong> {{ getMessage(s.acquiringStatus) }}
          </li>
          <li>
            <strong>Payout:</strong> {{ getMessage(s.payoutStatus) }}
          </li>
          <li *ngIf="user() && user()?.capital">
            <strong>Business Loans:</strong> {{ getMessage(s.capitalStatus) }}
          </li>
           <li *ngIf="user() && user()?.bank">
            <strong>Bank Account:</strong> {{ getMessage(s.bankingStatus) }}
          </li>
           <li *ngIf="user() && user()?.issuing">
            <strong>Issuing:</strong> {{ getMessage(s.issuingStatus) }}
          </li>
        </ul>
      </ng-template>
    </mat-card>

    <!-- BUSINESS LINES -->
    <mat-card class="business-card"
          *ngIf="user() && user()?.activityReason === 'embeddedPayment' ">
      <h2>Business Activity</h2>

      <!-- Existing Business Lines -->
      <div *ngIf="businessLines().length; else noBusinessLines">
        <mat-card *ngFor="let bl of businessLines()" class="business-line-card">
          <div><strong>ID:</strong> {{ bl.id }}</div>
          <div><strong>Industry:</strong> {{ getIndustryLabel(bl.industryCode) }} ({{ bl.industryCode }})</div>
          <div><strong>Channels:</strong>
    <span *ngFor="let ch of bl.salesChannels" class="channel-badge">{{ ch }}</span>
  </div>
        </mat-card>
      </div>
      <ng-template #noBusinessLines>
        <p>No business activity yet.</p>
      </ng-template>

      <form [formGroup]="businessForm" (ngSubmit)="addBusinessLine()">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Industry</mat-label>
          <mat-select formControlName="industryCode">
            <mat-option *ngFor="let ind of INDUSTRY_CODES" [value]="ind.code">
              {{ ind.label }} ({{ ind.code }})
            </mat-option>
          </mat-select>
        </mat-form-field>

        <label>Sales Channels</label>
        <div class="checkbox-group">
          <mat-checkbox formControlName="pos">POS</mat-checkbox>
          <mat-checkbox formControlName="eCommerce">eCommerce</mat-checkbox>
          <mat-checkbox formControlName="payByLink">Pay By Link</mat-checkbox>
        </div>

        <button mat-raised-button color="primary" class="full-width" type="submit" [disabled]="businessForm.invalid || submitting">
          Add Business Activity
        </button>
      </form>
    </mat-card>
    
    <mat-card class="kyc-test-card">
  <div class="kyc-test-content">
    <p class="warning-text">⚠️ Test only !</p>
    <button mat-raised-button color="warn" 
            (click)="validateKyc(userId)" 
            [disabled]="loadingKyc()">
      🔧 Validate KYC
      <mat-progress-spinner *ngIf="loadingKyc()" mode="indeterminate" diameter="20"></mat-progress-spinner>
    </button>
  </div>
</mat-card>

  </div>
  `,
    styles: [`
    .dashboard-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
    }

    .button-group {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .loading-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 1rem 0;
    }

    .status-card, .business-card {
      padding: 1rem;
      font-size: 1rem;
    }

    .business-line-card {
      border: 1px solid #ddd;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      border-radius: 6px;
      background-color: #fafafa;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .channel-badge {
  display: inline-block;
  background-color: #1976d2; /* couleur primaire */
  color: white;
  padding: 0.2rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  margin-right: 0.25rem;
  margin-top: 0.25rem;
}


    .checkbox-group {
      display: flex;
      gap: 1rem;
      margin: 0.5rem 0 1rem;
    }

    .full-width { width: 100%; }
    
    .kyc-test-card {
  padding: 1rem;
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  background-color: #fff;
  border-left: 4px solid #d32f2f; /* accent warning */
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 400px;
}

.kyc-test-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.kyc-test-card button {
  align-self: stretch;
  font-weight: bold;
}

.warning-text {
  color: #d32f2f;
  font-weight: bold;
  font-size: 0.85rem;
}
  `]
})
export class DashboardComponent {
    userId = '';
    readonly status = signal<OnboardingResponse | null>(null);
    readonly loading = signal(false);
    readonly businessLines = signal<BusinessLine[]>([]);
    readonly user = signal<User | null>(null);
    readonly loadingKyc = signal(false);
    submitting = false;

    readonly INDUSTRY_CODES = INDUSTRY_CODES;

    businessForm: FormGroup;

    private authService = inject(MyPlatformService);
    private route = inject(ActivatedRoute);
    private matSnackBar = inject(MatSnackBar);
    private fb = inject(FormBuilder);

    constructor() {
        this.businessForm = this.fb.group({
            industryCode: ['', Validators.required],
            pos: [false],
            eCommerce: [false],
            payByLink: [false]
        });
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            this.authService.getUserById(Number(this.userId)).subscribe({
                next: (u) => {
                    this.user.set(u);

                    //for bank it could be
                    // if (!(u.activityReason === 'marketplace' && u.bank === false)) {
                    //     this.loadBusinessLinesBanking();
                    // }
                    if (u.activityReason === 'embeddedPayment') {
                        this.loadBusinessLines();
                    }
                },
                error: () => {
                    this.matSnackBar.open('Error fetching user data', 'Close', {duration: 3000});
                }
            });
        });
    }

    openHostedOnboarding() {
        this.authService.getOnboardingLink(Number(this.userId)).subscribe({
            next: (res) => window.open(res.url, '_blank'),
            error: () => this.matSnackBar.open('Error fetching onboarding link', 'Close', {duration: 3000})
        });
    }

    checkOnboarding(): void {
        this.loading.set(true);
        this.authService.getOnboardingStatus(Number(this.userId)).subscribe({
            next: (res) => {
                this.status.set(res);
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.matSnackBar.open('Error while fetching onboarding status', 'Close', {duration: 3000});
            }
        });
    }

    allValid(s: OnboardingResponse): boolean {
        const isValid = (status?: { verificationStatus: string }) =>
            !status || status.verificationStatus === 'valid';

        return (
            isValid(s.acquiringStatus) &&
            isValid(s.payoutStatus) &&
            isValid(s.capitalStatus) &&
            isValid(s.bankingStatus) &&
            isValid(s.issuingStatus)
        );
    }

    getMessage(part: OnboardingPart | undefined): string {
        if (!part) {
            return 'ℹ️ No information available.';
        }

        switch (part.verificationStatus) {
            case 'invalid':
                return '❌ Missing or incorrect information. Please complete onboarding form.';
            case 'pending':
                return '⏳ Verification in progress. Please check back later.';
            case 'reject':
                return '🚫 Rejected. Please contact support@platform.com.';
            case 'valid':
                if (part.allowed) {
                    return '✅ Validated';
                } else {
                    return '❌ Not allowed';
                }
            default:
                return 'ℹ️ Unknown status.';
        }
    }

    getIndustryLabel(code: string): string {
        const ind = INDUSTRY_CODES.find(i => i.code === code);
        return ind ? ind.label : code;
    }

    loadBusinessLines() {
        this.authService.getBusinessLines(Number(this.userId)).subscribe({
            next: (res) => this.businessLines.set(res),
            error: () => this.matSnackBar.open('Error loading business lines', 'Close', {duration: 3000})
        });
    }

    addBusinessLine() {
        if (this.businessForm.invalid) return;

        const {industryCode, pos, eCommerce, payByLink} = this.businessForm.value;
        const salesChannels: string[] = [];
        if (pos) salesChannels.push('pos');
        if (eCommerce) salesChannels.push('eCommerce');
        if (payByLink) salesChannels.push('payByLink');

        if (!salesChannels.length) {
            this.matSnackBar.open('Select at least one sales channel', 'Close', {duration: 3000});
            return;
        }

        this.submitting = true;
        this.authService.addBusinessLine(Number(this.userId), {industryCode, salesChannels}).subscribe({
            next: (res) => {
                this.businessLines.set([...this.businessLines(), res]);
                this.matSnackBar.open('Business line added successfully', 'Close', {duration: 3000});
                this.businessForm.reset({industryCode: '', pos: false, eCommerce: false, payByLink: false});
                this.submitting = false;
            },
            error: () => {
                this.matSnackBar.open('Error adding business line', 'Close', {duration: 3000});
                this.submitting = false;
            }
        });
    }

    validateKyc(userId: string) {
        if (!userId) return;

        this.loadingKyc.set(true);

        this.authService.validateKyc(Number(userId)).subscribe({
            next: () => {
                this.loadingKyc.set(false);
                this.matSnackBar.open('✅ KYC validated', 'Close', {duration: 3000});
                this.checkOnboarding();
            },
            error: (err) => {
                console.error(err);
                this.loadingKyc.set(false);
                this.matSnackBar.open('❌ Error validating KYC', 'Close', {duration: 3000});
            }
        });
    }

}
