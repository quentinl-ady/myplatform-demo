import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatBadgeModule } from '@angular/material/badge';
import { MatIconModule } from '@angular/material/icon';

import { MyPlatformService, OnboardingPart, OnboardingResponse, User } from "../my-platform-service";
import { MaterialModule } from "../material.module";
import { INDUSTRY_CODES } from "../industry-codes";

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
    MatBadgeModule,
    MatIconModule
  ],
  template: `
    <div class="fintech-wrapper">

      <div class="header-section">
        <h2>Onboarding & Profile</h2>
        <p>Complete your business profile to unlock all platform features.</p>
      </div>

      <mat-card class="action-card">
        <div class="action-row">
          <div class="action-text">
            <h3>Complete your profile</h3>
            <p>Access the secure hosted environment to fill out your details.</p>
          </div>
          <button mat-flat-button class="fintech-btn primary" (click)="openHostedOnboarding()">
            Go to Onboarding
          </button>
        </div>

        <hr class="divider">

        <div class="action-row">
          <div class="action-text">
            <h3>Refresh Status</h3>
            <p>Check if your account features have been validated.</p>
          </div>
          <button mat-flat-button class="fintech-btn secondary" (click)="checkOnboarding()" [disabled]="loading()">
            <mat-icon *ngIf="!loading()">refresh</mat-icon>
            <mat-spinner *ngIf="loading()" diameter="20"></mat-spinner>
            <span *ngIf="!loading()">Check Status</span>
          </button>
        </div>
      </mat-card>

      <mat-card class="status-card" *ngIf="status() as s">
        <div class="success-state" *ngIf="allValid(s); else details">
          <div class="success-icon">
            <mat-icon>check_circle</mat-icon>
          </div>
          <h3>All set!</h3>
          <p>All services are validated. You can now use the platform without restrictions.</p>
        </div>

        <ng-template #details>
          <h3 class="card-title">Services Status</h3>
          <div class="status-list">
            <div class="status-item">
              <span class="status-label">Acquiring</span>
              <span class="status-value">{{ getMessage(s.acquiringStatus) }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">Payout</span>
              <span class="status-value">{{ getMessage(s.payoutStatus) }}</span>
            </div>
            <div class="status-item" *ngIf="user()?.capital">
              <span class="status-label">Business Loans</span>
              <span class="status-value">{{ getMessage(s.capitalStatus) }}</span>
            </div>
            <div class="status-item" *ngIf="user()?.bank">
              <span class="status-label">Bank Account</span>
              <span class="status-value">{{ getMessage(s.bankingStatus) }}</span>
            </div>
            <div class="status-item" *ngIf="user()?.issuing">
              <span class="status-label">Issuing</span>
              <span class="status-value">{{ getMessage(s.issuingStatus) }}</span>
            </div>
          </div>
        </ng-template>
      </mat-card>

      <mat-card class="business-card" *ngIf="user()?.activityReason === 'embeddedPayment'">
        <h3 class="card-title">Business Activity</h3>

        <div class="business-lines-container" *ngIf="businessLines().length; else noBusinessLines">
          <div *ngFor="let bl of businessLines()" class="business-line-item">
            <div class="bl-header">
              <span class="bl-industry">{{ getIndustryLabel(bl.industryCode) }}</span>
              <span class="bl-id">ID: {{ bl.id }}</span>
            </div>
            <div class="bl-channels">
              <span *ngFor="let ch of bl.salesChannels" class="channel-pill">{{ ch }}</span>
            </div>
          </div>
        </div>
        <ng-template #noBusinessLines>
          <p class="empty-text">No business activity registered yet.</p>
        </ng-template>

        <hr class="divider">

        <form [formGroup]="businessForm" (ngSubmit)="addBusinessLine()" class="business-form">
          <h4 class="form-title">Add new activity</h4>

          <div class="form-group">
            <label>Industry</label>
            <select class="fintech-input" formControlName="industryCode">
              <option value="" disabled selected>Select an industry...</option>
              <option *ngFor="let ind of INDUSTRY_CODES" [value]="ind.code">
                {{ ind.label }} ({{ ind.code }})
              </option>
            </select>
          </div>

          <div class="form-group">
            <label>Sales Channels</label>
            <div class="checkbox-group">
              <mat-checkbox formControlName="pos" color="primary">POS</mat-checkbox>
              <mat-checkbox formControlName="eCommerce" color="primary">eCommerce</mat-checkbox>
              <mat-checkbox formControlName="payByLink" color="primary">Pay By Link</mat-checkbox>
            </div>
          </div>

          <button mat-flat-button class="fintech-btn primary full-width" type="submit" [disabled]="businessForm.invalid || submitting">
            <span *ngIf="!submitting">Add Business Activity</span>
            <mat-spinner *ngIf="submitting" diameter="20" color="accent"></mat-spinner>
          </button>
        </form>
      </mat-card>

      <mat-card class="dev-tool-card">
        <div class="dev-tool-content">
          <div class="dev-tool-text">
            <h4><mat-icon>science</mat-icon> Developer Tool</h4>
            <p>Bypass the real KYC process for testing purposes.</p>
          </div>
          <button mat-flat-button class="fintech-btn warn-outline" (click)="validateKyc(userId)" [disabled]="loadingKyc()">
            <span *ngIf="!loadingKyc()">Validate KYC</span>
            <mat-spinner *ngIf="loadingKyc()" diameter="20" color="warn"></mat-spinner>
          </button>
        </div>
      </mat-card>

    </div>
  `,
  styles: [`
    :host {
      --fintech-primary: #000000;
      --fintech-bg: #f5f6f8;
      --fintech-surface: #ffffff;
      --fintech-text: #1a1a1a;
      --fintech-text-secondary: #737373;
      --fintech-border: #e5e5e5;
      --fintech-radius: 16px;
      --fintech-danger: #d32f2f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper {
      max-width: 600px;
      margin: 40px auto;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Header */
    .header-section {
      text-align: left;
      margin-bottom: 8px;
    }
    .header-section h2 {
      font-size: 28px;
      font-weight: 700;
      color: var(--fintech-text);
      margin: 0 0 8px 0;
      letter-spacing: -0.5px;
    }
    .header-section p {
      color: var(--fintech-text-secondary);
      font-size: 15px;
      margin: 0;
    }

    mat-card {
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
      padding: 24px;
    }
    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 20px 0;
      color: var(--fintech-text);
    }

    hr.divider {
      border: 0;
      border-top: 1px solid var(--fintech-border);
      margin: 20px 0;
    }

    /* Buttons */
    .fintech-btn {
      border-radius: 24px !important;
      padding: 8px 24px !important;
      font-weight: 600 !important;
      letter-spacing: 0 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .fintech-btn.primary {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }
    .fintech-btn.secondary {
      background-color: var(--fintech-bg) !important;
      color: var(--fintech-text) !important;
      border: none !important;
    }
    .fintech-btn.full-width {
      width: 100%;
      padding: 12px 24px !important;
      font-size: 15px !important;
    }

    /* Action Hub */
    .action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .action-text h3 {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 4px 0;
    }
    .action-text p {
      font-size: 13px;
      color: var(--fintech-text-secondary);
      margin: 0;
    }

    /* Status list */
    .status-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: var(--fintech-bg);
      border-radius: 12px;
    }
    .status-label {
      font-weight: 500;
      font-size: 14px;
      color: var(--fintech-text);
    }
    .status-value {
      font-size: 13px;
      color: var(--fintech-text-secondary);
      text-align: right;
      max-width: 60%;
    }

    .success-state {
      text-align: center;
      padding: 24px 0;
    }
    .success-icon {
      color: #4caf50;
      margin-bottom: 12px;
    }
    .success-icon mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
    }
    .success-state h3 {
      margin: 0 0 8px 0;
      font-size: 20px;
    }
    .success-state p {
      color: var(--fintech-text-secondary);
      margin: 0;
    }

    /* Business Lines */
    .business-lines-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .business-line-item {
      padding: 16px;
      border: 1px solid var(--fintech-border);
      border-radius: 12px;
      background: var(--fintech-surface);
    }
    .bl-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .bl-industry {
      font-weight: 600;
      font-size: 15px;
    }
    .bl-id {
      font-size: 12px;
      color: var(--fintech-text-secondary);
    }
    .bl-channels {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .channel-pill {
      background: var(--fintech-primary);
      color: white;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
    }
    .empty-text {
      color: var(--fintech-text-secondary);
      font-size: 14px;
      font-style: italic;
    }

    /* Form */
    .form-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--fintech-text-secondary);
      margin-bottom: 8px;
    }
    .fintech-input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid var(--fintech-border);
      border-radius: 10px;
      font-size: 15px;
      box-sizing: border-box;
      background: var(--fintech-surface);
      transition: border-color 0.2s;
      appearance: none;
    }
    .fintech-input:focus {
      outline: none;
      border-color: var(--fintech-primary);
    }
    .checkbox-group {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }

    /* Dev Tool Card */
    .dev-tool-card {
      background: #fffafa;
      border: 1px dashed #ffcdd2;
      box-shadow: none !important;
    }
    .dev-tool-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .dev-tool-text h4 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 4px 0;
      color: var(--fintech-danger);
      font-size: 15px;
    }
    .dev-tool-text h4 mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .dev-tool-text p {
      margin: 0;
      font-size: 13px;
      color: var(--fintech-text-secondary);
    }
    .warn-outline {
      border: 1px solid var(--fintech-danger) !important;
      color: var(--fintech-danger) !important;
      background: transparent !important;
    }
  `]
})
export class DashboardComponent implements OnInit {
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
          if (u.activityReason === 'embeddedPayment') {
            this.loadBusinessLines();
          }
        },
        error: () => {
          this.matSnackBar.open('Error fetching user data', 'Close', { duration: 3000 });
        }
      });
    });
  }

  openHostedOnboarding() {
    this.authService.getOnboardingLink(Number(this.userId)).subscribe({
      next: (res) => window.open(res.url, '_blank'),
      error: () => this.matSnackBar.open('Error fetching onboarding link', 'Close', { duration: 3000 })
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
    this.authService.getBusinessLines(Number(this.userId)).subscribe({
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
    this.authService.addBusinessLine(Number(this.userId), { industryCode, salesChannels }).subscribe({
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

  validateKyc(userId: string) {
    if (!userId) return;

    this.loadingKyc.set(true);

    this.authService.validateKyc(Number(userId)).subscribe({
      next: () => {
        this.loadingKyc.set(false);
        this.matSnackBar.open('✅ KYC validated', 'Close', { duration: 3000 });
        this.checkOnboarding();
      },
      error: (err) => {
        console.error(err);
        this.loadingKyc.set(false);
        this.matSnackBar.open('❌ Error validating KYC', 'Close', { duration: 3000 });
      }
    });
  }
}
