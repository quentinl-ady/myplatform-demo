import {Component, signal} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {CommonModule} from "@angular/common";
import {MyPlatformService, OnboardingPart, OnboardingResponse} from "../my-platform-service";

@Component({
    selector: 'app-dashboard',
    standalone: true,
    template: `
    <div class="main-container">
      <h1>Dashboard</h1>
      <div class="button-group">
      
      <button (click)="openHostedOnboarding()">
        Go to Onboarding
        </button>
                
        <button class="check-status" (click)="checkOnboarding()">Check Onboarding Status</button>
        
      </div>
      
        <div *ngIf="loading()">Loading...</div>

      <div *ngIf="status() as s">
        <div *ngIf="allValid(s); else details">
          ✅ All services are validated. You can now use the platform without restrictions.
        </div>

        <ng-template #details>
          <ul>
            <li>
              <strong>Acquiring:</strong>
              {{ getMessage(s.acquiringStatus) }}
            </li>
            <li>
              <strong>Payout:</strong>
              {{ getMessage(s.payoutStatus) }}
            </li>
          </ul>
        </ng-template>
      </div>
    </div>
  `,
    imports: [MatSnackBarModule, CommonModule]
})
export class DashboardComponent {
    userId = '';
    readonly status = signal<OnboardingResponse | null>(null);
    readonly loading = signal(false);

    constructor(private route: ActivatedRoute,
                private authService: MyPlatformService,
                private matSnackBar: MatSnackBar) {
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
        });
    }

    openHostedOnboarding() {
        this.authService.getOnboardingLink(Number(this.userId)).subscribe({
            next: (res) => {
                window.open(res.url, '_blank');
            },
            error: () => this.matSnackBar.open('Error', 'Close', { duration: 3000 })
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
                alert('Error while fetching onboarding status');
            }
        });
    }

    allValid(s: OnboardingResponse): boolean {
        return s.acquiringStatus.allowed && s.payoutStatus.allowed;
    }

    getMessage(part: OnboardingPart): string {
        if (part.allowed) {
            return '✅ Validated';
        }

        switch (part.verificationStatus) {
            case 'invalid':
                return '❌ Missing or incorrect information. Please complete onboarding form.';
            case 'pending':
                return '⏳ Verification in progress. Please check back later.';
            case 'reject':
                return '🚫 Rejected. Please contact support@platform.com.';
            default:
                return 'ℹ️ Unknown status.';
        }
    }
}
