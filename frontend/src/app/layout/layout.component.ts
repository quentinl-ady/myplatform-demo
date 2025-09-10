import { Component } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import {MaterialModule} from "../material.module";

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MaterialModule
    ],
    template: `
    <mat-sidenav-container class="sidenav-container">
      <mat-sidenav #drawer mode="side" class="sidenav" opened>
        <mat-toolbar color="primary" class="toolbar-logo">Menu</mat-toolbar>
        <mat-nav-list>
          <a mat-list-item [routerLink]="['/', userId, 'dashboard']" routerLinkActive="active">
            <mat-icon>dashboard</mat-icon>
            <span>Dashboard</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'payment']" routerLinkActive="active">
            <mat-icon>payment</mat-icon>
            <span>Payment</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'report']" routerLinkActive="active">
            <mat-icon>bar_chart</mat-icon>
            <span>Report</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'payout']" routerLinkActive="active">
            <mat-icon>account_balance</mat-icon>
            <span>Payout</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'dispute']" routerLinkActive="active">
            <mat-icon>report_problem</mat-icon>
            <span>Dispute</span>
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'businessloans']" routerLinkActive="active">
            <mat-icon>attach_money</mat-icon>
            <span>Business Loans</span>
          </a>
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content>
        <mat-toolbar color="primary" class="main-toolbar">
          <button mat-icon-button (click)="drawer.toggle()" class="mobile-toggle">
            <mat-icon>menu</mat-icon>
          </button>
          <span>MyPlatform.com</span>
        </mat-toolbar>

        <div class="content">
          <router-outlet></router-outlet>
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
    styles: [`
    .sidenav-container {
      height: 100vh;
    }

    .sidenav {
      width: 220px;
    }

    .toolbar-logo {
      text-align: center;
      font-weight: bold;
    }

    .main-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .content {
      padding: 1rem;
    }

    .mat-list-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .mat-list-item.active {
      background-color: rgba(25, 118, 210, 0.1);
      border-radius: 4px;
    }

    /* Responsive : mobile */
    @media (max-width: 768px) {
      .sidenav {
        width: 200px;
      }
      .mobile-toggle {
        display: inline-flex;
      }
    }

    @media (min-width: 769px) {
      .mobile-toggle {
        display: none;
      }
    }
  `]
})
export class LayoutComponent {
    userId = '';

    constructor(private route: ActivatedRoute) {
        this.route.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
        });
    }
}
