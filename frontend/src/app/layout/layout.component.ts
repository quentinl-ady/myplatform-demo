import { Component, inject, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { RouterModule, ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { A11yModule } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { AccountService, BrandingService, WebhookService } from '../services';
import { BankAccountStatus, User, UserBranding } from '../models';
import { Subscription, filter, map, distinctUntilChanged } from 'rxjs';
import { BrandingDialogComponent } from './branding-dialog.component';
import { ApiLogsComponent } from '../api-logs/api-logs.component';
import { DEFAULT_PLATFORM_NAME, PageTitleStrategy } from './page-title.strategy';
import { ConfirmService, httpErrorMessage, httpStatus } from '../shared';

type NavLock = 'embeddedPayment' | 'bankAccount' | 'capital' | 'issuing';

interface NavItem {
  label: string;
  icon: string;
  path: string;
  lock?: NavLock;
  badge?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

type AccountState = 'loading' | 'ready' | 'notFound' | 'error';

const MOBILE_QUERY = '(max-width: 959.98px)';
const WEBHOOK_POLL_MS = 30000;

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MaterialModule,
    A11yModule,
    ApiLogsComponent
  ],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css'
})
export class LayoutComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private brandingService = inject(BrandingService);
  private webhookService = inject(WebhookService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private confirmService = inject(ConfirmService);
  private breakpointObserver = inject(BreakpointObserver);
  private titleStrategy = inject(PageTitleStrategy);
  private cdr = inject(ChangeDetectorRef);

  readonly defaultPlatformName = DEFAULT_PLATFORM_NAME;

  readonly navSections: NavSection[] = [
    {
      title: 'Overview',
      items: [
        { label: 'Onboarding', icon: 'verified_user', path: 'dashboard' },
        { label: 'Reports', icon: 'bar_chart', path: 'report' },
        { label: 'Notifications', icon: 'notifications', path: 'notifications', badge: true }
      ]
    },
    {
      title: 'Payments & commerce',
      items: [
        { label: 'Transactions', icon: 'payment', path: 'transactions' },
        { label: 'Checkout', icon: 'shop', path: 'checkout' },
        { label: 'Captures', icon: 'price_check', path: 'captures' },
        { label: 'Point of sale', icon: 'computer', path: 'pos', lock: 'embeddedPayment' },
        { label: 'Pay by Link', icon: 'link', path: 'paybylink', lock: 'embeddedPayment' },
        { label: 'Stores', icon: 'store', path: 'store', lock: 'embeddedPayment' }
      ]
    },
    {
      title: 'Banking',
      items: [
        { label: 'Business account', icon: 'sync_alt', path: 'business-account', lock: 'bankAccount' },
        { label: 'Cash management', icon: 'account_balance_wallet', path: 'cash-management' },
        { label: 'Loans', icon: 'attach_money', path: 'businessloans', lock: 'capital' },
        { label: 'Trusted devices', icon: 'devices', path: 'business-account-device', lock: 'bankAccount' },
        { label: 'Bank transfers', icon: 'send', path: 'banktransfer', lock: 'bankAccount' },
        { label: 'Batch transfers', icon: 'playlist_add_check', path: 'batch-transfer', lock: 'bankAccount' }
      ]
    },
    {
      title: 'Cards',
      items: [
        { label: 'My cards', icon: 'credit_card', path: 'cards', lock: 'issuing' },
        { label: 'Create card', icon: 'add_card', path: 'card-create', lock: 'issuing' },
        { label: 'Card transactions', icon: 'receipt_long', path: 'card-transactions', lock: 'issuing' },
        { label: 'Test issued cards', icon: 'contactless', path: 'issuing-checkout', lock: 'issuing' },
        { label: 'Relayed authorisation', icon: 'tune', path: 'relayed-auth', lock: 'issuing' }
      ]
    },
    {
      title: 'Risk',
      items: [
        { label: 'Disputes', icon: 'gavel', path: 'dispute' }
      ]
    }
  ];

  userId = '';
  userEmail = '';
  user: User | null = null;
  accountState: AccountState = 'loading';
  accountError = '';
  customLogoSrc: string | null = null;
  customPlatformName: string | null = null;
  customThemeId: string | null = null;
  webhookUnreadCount = 0;

  bankAccountCreated = false;
  bankStatusFailed = false;

  isMobile = false;
  navOpen = true;
  apiPanelOpen = false;

  private subscriptions = new Subscription();
  private userSub?: Subscription;
  private bankStatusSub?: Subscription;
  private brandingSub?: Subscription;
  private webhookPollInterval?: ReturnType<typeof setInterval>;

  get platformName(): string { return this.customPlatformName || DEFAULT_PLATFORM_NAME; }
  get capitalEnabled(): boolean { return !!this.user?.capital; }
  get bankEnabled(): boolean { return !!this.user?.bank; }
  get bankAccountReady(): boolean { return this.bankEnabled && this.bankAccountCreated; }
  get issuingEnabled(): boolean { return !!this.user?.issuing; }
  get isEmbeddedPayment(): boolean { return this.user?.activityReason === 'embeddedPayment'; }

  get displayName(): string {
    const u = this.user;
    if (!u) return '';
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return fullName || u.legalEntityName?.trim() || '';
  }

  get initials(): string {
    const source = this.displayName || this.userEmail.split('@')[0] || '';
    const words = source.split(/[\s._\-+]+/).filter(w => /[a-z0-9]/i.test(w));
    if (!words.length) return '';
    const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    return letters.toUpperCase();
  }

  ngOnInit() {
    this.subscriptions.add(
      this.breakpointObserver.observe(MOBILE_QUERY).subscribe(state => {
        this.isMobile = state.matches;
        this.navOpen = !this.isMobile;
      })
    );

    this.subscriptions.add(
      this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
        if (this.isMobile && this.navOpen) {
          this.navOpen = false;
          this.cdr.detectChanges();
        }
      })
    );

    this.subscriptions.add(
      this.route.paramMap.pipe(
        map(params => params.get('id') || ''),
        distinctUntilChanged()
      ).subscribe(id => this.loadAccount(id))
    );

    this.subscriptions.add(
      this.accountService.onBankAccountCreated$.subscribe(() => {
        this.bankAccountCreated = true;
        this.bankStatusFailed = false;
        this.cdr.detectChanges();
      })
    );

    this.subscriptions.add(
      this.webhookService.onWebhookReceived$.subscribe(() => this.loadWebhookCount())
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.resetAccountState();
    this.titleStrategy.setPlatformName(null);
  }

  retryAccount() {
    this.accountService.invalidateUserCache();
    this.loadAccount(this.userId);
  }

  private loadAccount(id: string) {
    this.resetAccountState();
    this.userId = id;
    if (!id) return;

    this.accountState = 'loading';
    this.userSub = this.accountService.getUserById(id).subscribe({
      next: (user) => {
        this.user = user;
        this.userEmail = user.email || '';
        this.accountState = 'ready';
        if (user.bank) {
          this.loadBankAccountStatus();
        }
        this.startWebhookPolling();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.user = null;
        this.userEmail = '';
        if (httpStatus(err) === 404) {
          this.accountState = 'notFound';
        } else {
          this.accountState = 'error';
          this.accountError = httpErrorMessage(err, 'We couldn\'t load this account. Please try again.');
        }
        this.cdr.detectChanges();
      }
    });
    this.loadBranding();
  }

  private resetAccountState() {
    this.userSub?.unsubscribe();
    this.bankStatusSub?.unsubscribe();
    this.brandingSub?.unsubscribe();
    this.stopWebhookPolling();
    this.user = null;
    this.userEmail = '';
    this.accountError = '';
    this.bankAccountCreated = false;
    this.bankStatusFailed = false;
    this.webhookUnreadCount = 0;
    this.apiPanelOpen = false;
    this.applyBranding(null);
  }

  lockReason(item: NavItem): string | null {
    if (!item.lock) return null;
    if (this.accountState === 'loading') return 'Loading your account…';
    if (this.accountState !== 'ready') return 'This account couldn\'t be loaded';
    switch (item.lock) {
      case 'embeddedPayment':
        return this.isEmbeddedPayment ? null : 'Available for platforms using embedded payments';
      case 'capital':
        return this.capitalEnabled ? null : 'Enable Capital when creating the account to use loans';
      case 'issuing':
        return this.issuingEnabled ? null : 'Enable Issuing when creating the account to use cards';
      case 'bankAccount':
        if (this.bankAccountReady) return null;
        if (!this.bankEnabled) return 'Enable Bank when creating the account to use business accounts';
        if (this.bankStatusFailed) return 'We couldn\'t check your business bank account. Reload the page to try again.';
        return 'Create your business bank account on the Onboarding page to unlock this';
      default:
        return null;
    }
  }

  onNavItemClick() {
    if (this.isMobile) {
      this.navOpen = false;
    }
  }

  toggleNav() {
    this.navOpen = !this.navOpen;
  }

  private loadWebhookCount() {
    if (!this.userId || this.accountState !== 'ready') return;
    this.webhookService.getUnreadCount(this.userId).subscribe({
      next: (res) => {
        this.webhookUnreadCount = res.unreadCount;
        this.cdr.detectChanges();
      },
      // The badge is secondary information; keep the last known count on failure.
      error: () => {}
    });
  }

  private startWebhookPolling() {
    this.stopWebhookPolling();
    this.loadWebhookCount();
    this.webhookPollInterval = setInterval(() => this.loadWebhookCount(), WEBHOOK_POLL_MS);
  }

  private stopWebhookPolling() {
    if (this.webhookPollInterval) {
      clearInterval(this.webhookPollInterval);
      this.webhookPollInterval = undefined;
    }
  }

  private loadBankAccountStatus() {
    this.bankStatusSub?.unsubscribe();
    this.bankStatusSub = this.accountService.getBankAccountStatus(this.userId).subscribe({
      next: (status: BankAccountStatus) => {
        this.bankAccountCreated = !!status?.bankAccountCreated;
        this.bankStatusFailed = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.bankAccountCreated = false;
        this.bankStatusFailed = true;
        this.cdr.detectChanges();
      }
    });
  }

  private loadBranding() {
    this.brandingSub?.unsubscribe();
    this.brandingSub = this.brandingService.getBranding(this.userId).subscribe(branding => {
      this.applyBranding(branding);
      this.cdr.detectChanges();
    });
  }

  private applyBranding(branding: UserBranding | null) {
    this.customPlatformName = branding?.platformName || null;
    this.customLogoSrc = branding?.logoData || null;
    this.customThemeId = branding?.themeId || null;
    this.titleStrategy.setPlatformName(this.customPlatformName);
  }

  onLogoError() {
    this.customLogoSrc = null;
  }

  openBrandingDialog() {
    const ref = this.dialog.open(BrandingDialogComponent, {
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: 'first-tabbable',
      data: {
        platformName: this.platformName,
        logoPreview: this.customLogoSrc,
        themeId: this.customThemeId
      }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      if (result.action === 'reset') {
        this.resetBranding();
      } else if (result.action === 'save') {
        this.saveBranding(result);
      }
    });
  }

  private async resetBranding() {
    const confirmed = await this.confirmService.confirm({
      title: 'Reset branding?',
      message: 'The platform name, logo and hosted onboarding theme go back to their defaults.',
      confirmText: 'Reset branding',
      danger: true
    });
    if (!confirmed) return;
    this.brandingService.resetBranding(this.userId).subscribe({
      next: () => {
        this.applyBranding(null);
        this.cdr.detectChanges();
        this.snackBar.open('Branding reset to default', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
      },
      error: (err) => this.showError(httpErrorMessage(err, 'We couldn\'t reset the branding. Please try again.'))
    });
  }

  private saveBranding(result: { platformName?: string; logoData?: string | null; logoType?: string | null; themeId?: string }) {
    const payload: { platformName?: string; logoData?: string; logoType?: string; themeId?: string } = {};
    if (result.platformName) payload.platformName = result.platformName;
    if (result.logoData) {
      payload.logoData = result.logoData;
      payload.logoType = result.logoType as string;
    }
    payload.themeId = result.themeId || '';
    this.brandingService.updateBranding(this.userId, payload).subscribe({
      next: (branding) => {
        this.applyBranding(branding);
        this.cdr.detectChanges();
        this.snackBar.open('Branding saved', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
      },
      error: (err) => this.showError(httpErrorMessage(err, 'We couldn\'t save the branding. Please try again.'))
    });
  }

  private showError(message: string) {
    this.snackBar.open(message, 'Close', { duration: 6000, panelClass: 'fintech-snack-error' });
  }

  toggleApiPanel() {
    this.apiPanelOpen = !this.apiPanelOpen;
  }

  closeApiPanel() {
    this.apiPanelOpen = false;
  }

  signOut() {
    this.resetAccountState();
    this.accountService.invalidateUserCache();
    this.router.navigate(['/'], { replaceUrl: true });
  }
}
