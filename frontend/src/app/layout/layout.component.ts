import { Component, inject } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatListModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule
  ],
  template: `
    <mat-sidenav-container class="fintech-layout-container">

      <mat-sidenav #drawer mode="side" class="fintech-sidenav" opened>

        <div class="brand-header">
          <div class="logo-mark">
            <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
              <rect width="40" height="40" rx="8" fill="#000"/>
              <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="18" font-weight="700" font-family="system-ui">MP</text>
            </svg>
          </div>
          <span class="brand-name">MyPlatform</span>
        </div>

        <mat-nav-list class="fintech-nav-list">
          <p class="nav-section-title">Overview</p>
          <a mat-list-item [routerLink]="['/', userId, 'dashboard']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>verified_user</mat-icon>
            <span matListItemTitle>Onboarding</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'report']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>bar_chart</mat-icon>
            <span matListItemTitle>Reports</span>
          </a>

          <p class="nav-section-title">Payments & Commerce</p>
          <a mat-list-item [routerLink]="['/', userId, 'payment']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>payment</mat-icon>
            <span matListItemTitle>Payments</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'checkout']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>shop</mat-icon>
            <span matListItemTitle>Checkout</span>
          </a>
           <a mat-list-item [routerLink]="['/', userId, 'pos']" routerLinkActive="active-link">
              <mat-icon matListItemIcon>computer</mat-icon>
              <span matListItemTitle>POS</span>
           </a>
          <a mat-list-item [routerLink]="['/', userId, 'paybylink']" routerLinkActive="active-link">
             <mat-icon matListItemIcon>link</mat-icon>
             <span matListItemTitle>Pay-by-Link</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'store']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>store</mat-icon>
            <span matListItemTitle>Stores</span>
          </a>

          <p class="nav-section-title">Banking & Finance</p>
          <a mat-list-item [routerLink]="['/', userId, 'transfer']" routerLinkActive="active-link">
              <mat-icon matListItemIcon>sync_alt</mat-icon>
              <span matListItemTitle>Transfers</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'payout']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>account_balance</mat-icon>
            <span matListItemTitle>Payouts</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'businessloans']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>attach_money</mat-icon>
            <span matListItemTitle>Extra money ?</span>
          </a>

          <p class="nav-section-title">Cards</p>
          <a mat-list-item [routerLink]="['/', userId, 'cards']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>credit_card</mat-icon>
            <span matListItemTitle>My Cards</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'card-create']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>add_card</mat-icon>
            <span matListItemTitle>Create Card</span>
          </a>

          <p class="nav-section-title">Security & Risk</p>
          <a mat-list-item [routerLink]="['/', userId, 'device']" routerLinkActive="active-link">
             <mat-icon matListItemIcon>devices</mat-icon>
             <span matListItemTitle>Trusted Devices</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'dispute']" routerLinkActive="active-link">
            <mat-icon matListItemIcon>gavel</mat-icon>
            <span matListItemTitle>Disputes</span>
          </a>
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content class="fintech-content-wrapper">

        <mat-toolbar class="fintech-topbar">
          <button mat-icon-button (click)="drawer.toggle()" class="mobile-toggle">
            <mat-icon>menu</mat-icon>
          </button>

          <div class="spacer"></div>

          <div class="user-profile">
            <div class="user-info">
              <span class="user-role">Account ID</span>
              <span class="user-id">#{{ userId || 'N/A' }}</span>
            </div>
            <div class="user-avatar">
              <mat-icon>person</mat-icon>
            </div>
          </div>
        </mat-toolbar>

        <main class="main-content">
          <router-outlet></router-outlet>
        </main>

      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    :host {
      --fintech-primary: #000000;
      --fintech-bg: #f5f6f8;
      --fintech-surface: #ffffff;
      --fintech-text: #1a1a1a;
      --fintech-text-secondary: #737373;
      --fintech-border: #e5e5e5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: block;
      height: 100vh;
    }

    .fintech-layout-container {
      height: 100vh;
      background-color: var(--fintech-bg);
    }

    /* --- SIDEBAR --- */
    .fintech-sidenav {
      width: 260px;
      background-color: var(--fintech-surface);
      border-right: 1px solid var(--fintech-border) !important;
    }

    .brand-header {
      height: 64px;
      display: flex;
      align-items: center;
      padding: 0 24px;
      gap: 12px;
      border-bottom: 1px solid var(--fintech-border);
    }
    .logo-mark {
      width: 32px;
      height: 32px;
      background-color: var(--fintech-primary);
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-mark mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  .logo-mark img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
    .brand-name {
      font-size: 18px;
      font-weight: 700;
      color: var(--fintech-text);
      letter-spacing: -0.5px;
    }

    /* Navigation List */
    .fintech-nav-list {
      padding: 16px 12px !important;
    }
    .nav-section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      color: var(--fintech-text-secondary);
      margin: 16px 0 8px 16px;
    }
    .nav-section-title:first-child {
      margin-top: 0;
    }

    ::ng-deep .fintech-nav-list .mat-mdc-list-item {
      border-radius: 8px !important;
      margin-bottom: 4px !important;
      color: var(--fintech-text) !important;
      transition: all 0.2s ease;
    }
    ::ng-deep .fintech-nav-list .mat-mdc-list-item:hover {
      background-color: var(--fintech-bg) !important;
    }
    ::ng-deep .fintech-nav-list .mat-mdc-list-item-icon {
      color: var(--fintech-text-secondary) !important;
      margin-right: 12px !important;
    }

    /* Active State (The Pill) */
    ::ng-deep .fintech-nav-list .active-link {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }
    ::ng-deep .fintech-nav-list .active-link .mat-mdc-list-item-title,
    ::ng-deep .fintech-nav-list .active-link .mat-mdc-list-item-icon {
      color: white !important;
      font-weight: 500 !important;
    }

    /* --- MAIN CONTENT & TOPBAR --- */
    .fintech-content-wrapper {
      background-color: var(--fintech-bg);
      display: flex;
      flex-direction: column;
    }

    .fintech-topbar {
      background-color: var(--fintech-surface);
      border-bottom: 1px solid var(--fintech-border);
      height: 64px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      z-index: 10;
    }

    .spacer {
      flex: 1 1 auto;
    }

    /* User Profile in Topbar */
    .user-profile {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 8px;
      transition: background 0.2s ease;
    }
    .user-profile:hover {
      background-color: var(--fintech-bg);
    }
    .user-info {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .user-role {
      font-size: 11px;
      color: var(--fintech-text-secondary);
      font-weight: 500;
    }
    .user-id {
      font-size: 13px;
      font-weight: 600;
      color: var(--fintech-text);
    }
    .user-avatar {
      width: 36px;
      height: 36px;
      background-color: #e3e8ee;
      color: #64748b;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .main-content {
      padding: 24px;
      flex-grow: 1;
      overflow-y: auto;
    }

    /* --- RESPONSIVE --- */
    .mobile-toggle {
      display: none !important;
      margin-left: -12px;
      margin-right: 12px;
      color: var(--fintech-text) !important;
    }

    @media (max-width: 992px) {
      .fintech-sidenav {
        width: 240px;
      }
      .mobile-toggle {
        display: inline-flex !important;
      }
      .fintech-topbar {
        padding: 0 16px;
      }
      .main-content {
        padding: 16px;
      }
    }
  `]
})
export class LayoutComponent {
  userId = '';
  private route = inject(ActivatedRoute);

  constructor() {
    this.route.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
    });
  }
}
