import {Component, OnInit, OnDestroy, signal} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import { AdyenPlatformExperience, ReportsOverview } from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";

@Component({
    selector: 'app-report',
    standalone: true,
    template: `
    <div class="fintech-wrapper">
      <div class="header-section">
        <div class="header-row">
          <div>
            <h2>Reports</h2>
            <p>Download and review your financial reports.</p>
          </div>
          <button mat-icon-button class="refresh-btn" (click)="refresh()" [disabled]="refreshing()" matTooltip="Refresh reports">
            <mat-icon [class.spinning]="refreshing()">refresh</mat-icon>
          </button>
        </div>
      </div>
      <mat-card class="component-card">
        <div id="report-overview-container"></div>
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
        --fintech-radius: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .fintech-wrapper {
        max-width: 1200px;
        margin: 40px 0 40px 40px;
        padding: 0 16px;
        display: flex;
        flex-direction: column;
        gap: 24px;
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
      .header-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .refresh-btn {
        color: var(--fintech-text-secondary);
        transition: color 0.2s;
      }
      .refresh-btn:hover { color: var(--fintech-text); }
      mat-card {
        background: var(--fintech-surface);
        border-radius: var(--fintech-radius);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
        padding: 24px;
      }
      .spinning { animation: spin 1s linear infinite; }
      @keyframes spin { 100% { transform: rotate(360deg); } }
    `],
    imports: [CommonModule, MaterialModule]
})
export class ReportComponent implements OnInit, OnDestroy {

    userId = '';
    readonly refreshing = signal(false);
    private reportsOverview: ReportsOverview | null = null;

    constructor(private route: ActivatedRoute,
                private sessionService: SessionService,
                private matSnackBar: MatSnackBar) {
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.initAdyenComponents();
            }
        });
    }

    ngOnDestroy() {
        this.reportsOverview?.unmount();
        this.reportsOverview = null;
    }

    async refresh() {
        this.refreshing.set(true);
        this.reportsOverview?.unmount();
        this.reportsOverview = null;
        const container = document.getElementById('report-overview-container');
        if (container) container.innerHTML = '';
        await this.initAdyenComponents();
        this.refreshing.set(false);
    }

    private async initAdyenComponents() {
        const core = await AdyenPlatformExperience({
            onSessionCreate: async () => {
                const sessionToken = await this.sessionService.getReportInformation(this.userId).toPromise();
                if (!sessionToken) {
                    throw new Error('Impossible to get report information');
                }
                return {
                    token: sessionToken.token,
                    id: sessionToken.id
                };
            }
        });
        this.reportsOverview = new ReportsOverview({core});
        this.reportsOverview.mount('#report-overview-container');
    }
}
