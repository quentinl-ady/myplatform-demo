import { Component, signal, inject, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from "@angular/common";
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';

import { OnboardingPart, OnboardingResponse, User, BankAccountStatus, BusinessLine } from "../models";
import { AccountService, OnboardingService, SessionService, ActivityService } from "../services";
import { MaterialModule } from "../material.module";
import { INDUSTRY_CODES } from "../industry-codes";
import '@adyen/kyc-components/transfer-instrument-management';
import '@adyen/kyc-components/transfer-instrument-configuration';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private bankStatusInterval: ReturnType<typeof setTimeout> | null = null;
  private bankStatusDelay = 5000;
  private static readonly BANK_STATUS_MAX_DELAY = 60000;
  userId = '';
  readonly status = signal<OnboardingResponse | null>(null);
  readonly loading = signal(false);
  readonly businessLines = signal<BusinessLine[]>([]);
  readonly user = signal<User | null>(null);
  readonly loadingKyc = signal(false);
  readonly creatingBankAccount = signal(false);
  readonly bankStatus = signal<BankAccountStatus | null>(null);
  submitting = false;

  readonly INDUSTRY_CODES = INDUSTRY_CODES;

  businessForm: FormGroup;

  private accountService = inject(AccountService);
  private onboardingService = inject(OnboardingService);
  private sessionService = inject(SessionService);
  private activityService = inject(ActivityService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
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
      this.accountService.getUserById(Number(this.userId)).subscribe({
        next: (u) => {
          this.user.set(u);
          if (u.bank) {
            this.loadBankAccountStatus();
            this.startBankStatusPolling();
          }
          if (u.activityReason === 'embeddedPayment') {
            this.loadBusinessLines();
          }
          if (u.legalEntityId) {
            this.initTransferInstrumentComponent(u.legalEntityId);
          }
        },
        error: () => {
          this.matSnackBar.open('Error fetching user data', 'Close', { duration: 3000 });
        }
      });
    });
  }

  openHostedOnboarding() {
    this.onboardingService.getOnboardingLink(Number(this.userId)).subscribe({
      next: (res) => window.open(res.url, '_blank'),
      error: () => this.matSnackBar.open('Error fetching onboarding link', 'Close', { duration: 3000 })
    });
  }

  checkOnboarding(): void {
    this.loading.set(true);
    this.onboardingService.getOnboardingStatus(Number(this.userId)).subscribe({
      next: (res) => {
        this.status.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.matSnackBar.open('Error while fetching onboarding status', 'Close', { duration: 3000 });
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
        return '❌ Missing or incorrect information.';
      case 'pending':
        return '⏳ Verification in progress.';
      case 'reject':
        return '🚫 Rejected. Please contact support.';
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
    this.activityService.getBusinessLines(Number(this.userId)).subscribe({
      next: (res) => this.businessLines.set(res),
      error: () => this.matSnackBar.open('Error loading business lines', 'Close', { duration: 3000 })
    });
  }

  addBusinessLine() {
    if (this.businessForm.invalid) return;

    const { industryCode, pos, eCommerce, payByLink } = this.businessForm.value;
    const salesChannels: string[] = [];
    if (pos) salesChannels.push('pos');
    if (eCommerce) salesChannels.push('eCommerce');
    if (payByLink) salesChannels.push('payByLink');

    if (!salesChannels.length) {
      this.matSnackBar.open('Select at least one sales channel', 'Close', { duration: 3000 });
      return;
    }

    this.submitting = true;
    this.activityService.addBusinessLine(Number(this.userId), { industryCode, salesChannels }).subscribe({
      next: (res) => {
        this.businessLines.set([...this.businessLines(), res]);
        this.matSnackBar.open('Business line added successfully', 'Close', { duration: 3000 });
        this.businessForm.reset({ industryCode: '', pos: false, eCommerce: false, payByLink: false });
        this.submitting = false;
      },
      error: () => {
        this.matSnackBar.open('Error adding business line', 'Close', { duration: 3000 });
        this.submitting = false;
      }
    });
  }

  private tiLegalEntityId = '';

  private getFetchToken() {
    return async () => {
      const session = await this.sessionService.getExternalBankAccountSession(this.userId).toPromise();
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
    el.addEventListener('remove', (e: any) => {
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
    this.accountService.getBankAccountStatus(Number(this.userId)).subscribe({
      next: (status) => {
        this.bankStatus.set(status);
        if (status.bankAccountCreated) {
          this.stopBankStatusPolling();
        }
      },
      error: () => {}
    });
  }

  private startBankStatusPolling() {
    this.stopBankStatusPolling();
    this.bankStatusDelay = 5000;
    this.scheduleBankStatusPoll();
  }

  private scheduleBankStatusPoll() {
    this.bankStatusInterval = setTimeout(() => {
      this.loadBankAccountStatus();
      this.bankStatusDelay = Math.min(this.bankStatusDelay * 2, DashboardComponent.BANK_STATUS_MAX_DELAY);
      this.scheduleBankStatusPoll();
    }, this.bankStatusDelay);
  }

  private stopBankStatusPolling() {
    if (this.bankStatusInterval) {
      clearTimeout(this.bankStatusInterval);
      this.bankStatusInterval = null;
    }
  }

  ngOnDestroy() {
    this.stopBankStatusPolling();
  }

  createBankAccount() {
    if (!this.userId) return;
    this.creatingBankAccount.set(true);

    this.accountService.createBankAccount(Number(this.userId)).subscribe({
      next: (res) => {
        this.creatingBankAccount.set(false);
        this.loadBankAccountStatus();
        this.matSnackBar.open('✅ Bank account created: ' + res.bankAccountNumber, 'Close', { duration: 5000 });
      },
      error: (err) => {
        this.creatingBankAccount.set(false);
        this.matSnackBar.open('❌ Error creating bank account', 'Close', { duration: 3000 });
      }
    });
  }

  goToTransfers() {
    this.router.navigate(['/', this.userId, 'transfer']);
  }

  validateKyc(userId: string) {
    if (!userId) return;

    this.loadingKyc.set(true);

    this.onboardingService.validateKyc(Number(userId)).subscribe({
      next: () => {
        this.loadingKyc.set(false);
        this.matSnackBar.open('✅ KYC validated', 'Close', { duration: 3000 });
        this.checkOnboarding();
      },
      error: (err) => {
        this.loadingKyc.set(false);
        this.matSnackBar.open('❌ Error validating KYC', 'Close', { duration: 3000 });
      }
    });
  }
}
