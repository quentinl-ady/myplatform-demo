import { Component, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from "@angular/common";
import { MyPlatformService, OnboardingPart, OnboardingResponse } from "../my-platform-service";
import {MaterialModule} from "../material.module";

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, MaterialModule],
    template: `
    <div class="dashboard-container">
      <h1>Dashboard</h1>

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
          </ul>
        </ng-template>
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

    .status-card {
      padding: 1rem;
      font-size: 1rem;
    }
  `]
})
export class DashboardComponent {
    userId = '';
    readonly status = signal<OnboardingResponse | null>(null);
    readonly loading = signal(false);

    constructor(private route: ActivatedRoute,
                private authService: MyPlatformService,
                private matSnackBar: MatSnackBar) {}

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
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
        return s.acquiringStatus.allowed && s.payoutStatus.allowed;
    }

    getMessage(part: OnboardingPart): string {
        if (part.allowed) return '✅ Validated';
        switch (part.verificationStatus) {
            case 'invalid': return '❌ Missing or incorrect information. Please complete onboarding form.';
            case 'pending': return '⏳ Verification in progress. Please check back later.';
            case 'reject': return '🚫 Rejected. Please contact support@platform.com.';
            default: return 'ℹ️ Unknown status.';
        }
    }
}
