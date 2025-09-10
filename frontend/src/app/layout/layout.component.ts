import { Component } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatSidenavModule,
        MatListModule,
        MatToolbarModule
    ],
/*    template: `
    <mat-sidenav-container class="sidenav-container">
      <mat-sidenav mode="side" opened>
        <mat-toolbar color="primary">Menu</mat-toolbar>
        <mat-nav-list>
          <a mat-list-item [routerLink]="['/', userId, 'dashboard']" routerLinkActive="active">
            Dashboard
          </a>
          <a mat-list-item [routerLink]="['/', userId, 'payment']" routerLinkActive="active">
            Payment
          </a>
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content>
        <mat-toolbar color="primary">Application {{ userId }}</mat-toolbar>
        <div class="content">
          <router-outlet></router-outlet>
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,*/
    template: `
    <mat-sidenav-container class="sidenav-container">
  <mat-sidenav mode="side" opened>
    <mat-toolbar>Menu</mat-toolbar>
    <mat-nav-list>
      <a mat-list-item [routerLink]="['/', userId, 'dashboard']"
         routerLinkActive="active"
         class="menu-link">
        Dashboard
      </a>
      <a mat-list-item [routerLink]="['/', userId, 'payment']"
         routerLinkActive="active"
         class="menu-link">
        Payment
      </a>
    </mat-nav-list>
  </mat-sidenav>

  <mat-sidenav-content>
    <mat-toolbar>MyPlatform.com</mat-toolbar>
    <div class="content">
      <router-outlet></router-outlet>
    </div>
  </mat-sidenav-content>
</mat-sidenav-container>
  `
})
export class LayoutComponent {
    userId = '';

    constructor(private route: ActivatedRoute) {
        this.route.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
        });
    }
}
