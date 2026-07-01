import { Component, inject, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MaterialModule } from '../material.module';
import { AccountService, BrandingService, WebhookService } from '../services';
import { BankAccountStatus, User } from '../models';
import { Subscription } from 'rxjs';
import { BrandingDialogComponent } from './branding-dialog.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MaterialModule
  ],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css'
})
export class LayoutComponent implements OnInit, OnDestroy {
  private bankAccountSub?: Subscription;
  userId = '';
  userEmail = '';
  user: User | null = null;
  customLogoSrc: string | null = null;
  customPlatformName: string | null = null;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private brandingService = inject(BrandingService);
  private webhookService = inject(WebhookService);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);
  webhookUnreadCount = 0;
  private webhookSub?: Subscription;
  private webhookPollInterval?: any;

  get capitalEnabled(): boolean { return !!this.user?.capital; }
  get bankEnabled(): boolean { return !!this.user?.bank; }
  bankAccountCreated = false;
  get bankAccountReady(): boolean { return this.bankEnabled && this.bankAccountCreated; }
  get issuingEnabled(): boolean { return !!this.user?.issuing; }
  get isEmbeddedPayment(): boolean { return this.user?.activityReason === 'embeddedPayment'; }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.accountService.getUserById(this.userId).subscribe({
          next: (user) => {
            this.user = user;
            this.userEmail = user.email;
            if (user.bank) {
              this.loadBankAccountStatus();
            }
            this.startWebhookPolling();
            this.cdr.detectChanges();
          },
          error: () => {
            this.user = null;
            this.userEmail = '';
            this.cdr.detectChanges();
          }
        });
        this.loadBranding();
      }
    });

    this.bankAccountSub = this.accountService.onBankAccountCreated$.subscribe(() => {
      this.bankAccountCreated = true;
      this.cdr.detectChanges();
    });

    this.webhookSub = this.webhookService.onWebhookReceived$.subscribe(() => {
      this.loadWebhookCount();
    });
  }

  ngOnDestroy() {
    this.bankAccountSub?.unsubscribe();
    this.webhookSub?.unsubscribe();
    if (this.webhookPollInterval) {
      clearInterval(this.webhookPollInterval);
    }
  }

  private loadWebhookCount() {
    if (!this.userId) return;
    this.webhookService.getUnreadCount(this.userId).subscribe({
      next: (res) => {
        this.webhookUnreadCount = res.unreadCount;
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  private startWebhookPolling() {
    this.loadWebhookCount();
    this.webhookPollInterval = setInterval(() => this.loadWebhookCount(), 30000);
  }

  private loadBankAccountStatus() {
    this.accountService.getBankAccountStatus(this.userId).subscribe({
      next: (status: BankAccountStatus) => {
        this.bankAccountCreated = status.bankAccountCreated;
        this.cdr.detectChanges();
      },
      error: () => {
        this.bankAccountCreated = false;
      }
    });
  }

  private loadBranding() {
    this.brandingService.getBranding(this.userId).subscribe(branding => {
      if (branding) {
        this.customPlatformName = branding.platformName || null;
        this.customLogoSrc = branding.logoData || null;
      } else {
        this.customPlatformName = null;
        this.customLogoSrc = null;
      }
      this.cdr.detectChanges();
    });
  }

  openBrandingDialog() {
    const ref = this.dialog.open(BrandingDialogComponent, {
      data: {
        platformName: this.customPlatformName || 'My Platform',
        logoPreview: this.customLogoSrc
      }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      if (result.action === 'reset') {
        this.brandingService.resetBranding(this.userId).subscribe(() => {
          this.customPlatformName = null;
          this.customLogoSrc = null;
          this.cdr.detectChanges();
        });
      } else if (result.action === 'save') {
        const payload: any = {};
        if (result.platformName) payload.platformName = result.platformName;
        if (result.logoData) {
          payload.logoData = result.logoData;
          payload.logoType = result.logoType;
        }
        this.brandingService.updateBranding(this.userId, payload).subscribe(branding => {
          this.customPlatformName = branding.platformName || null;
          this.customLogoSrc = branding.logoData || null;
          this.cdr.detectChanges();
        });
      }
    });
  }

  signOut() {
    this.router.navigate(['/']);
  }
}
