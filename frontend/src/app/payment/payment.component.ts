import {Component, OnInit, OnDestroy, signal, inject, DestroyRef} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import { firstValueFrom } from 'rxjs';
import {
    AdyenPlatformExperience,
    TransactionsOverview
} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";
import {httpErrorMessage} from '../shared';

@Component({
    selector: 'app-payment',
    standalone: true,
    imports: [CommonModule, MaterialModule],
    template: `
    <div class="fintech-wrapper">
      <div class="header-section">
        <div class="header-row">
          <div>
            <h1>Transactions</h1>
            <p>View and manage all incoming payments.</p>
          </div>
          <button mat-icon-button type="button" class="refresh-btn" (click)="refresh()" [disabled]="refreshing()"
                  matTooltip="Refresh transactions" aria-label="Refresh transactions">
            <mat-icon [class.spinning]="refreshing()" aria-hidden="true">refresh</mat-icon>
          </button>
        </div>
      </div>

      <mat-card class="state-card" *ngIf="loadError() as error" role="alert">
        <mat-icon class="state-icon" aria-hidden="true">error_outline</mat-icon>
        <h2>Could not load transactions</h2>
        <p>{{ error }}</p>
        <button mat-flat-button type="button" class="fintech-btn primary" (click)="refresh()" [disabled]="refreshing()">Retry</button>
      </mat-card>

      <mat-card class="component-card" [hidden]="!!loadError()" [attr.aria-busy]="refreshing()">
        <div class="loading-state" *ngIf="refreshing()" role="status">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Loading transactions…</span>
        </div>
        <div id="transactions-overview-container"></div>
      </mat-card>
    </div>
  `,
    styles: [`
      .fintech-wrapper {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 16px;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .header-section h1 {
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
        gap: 16px;
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
      .component-card[hidden] { display: none !important; }
      .state-card { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 48px 24px; }
      .state-card h2 { margin: 0; font-size: 18px; font-weight: 600; }
      .state-card p { margin: 0; font-size: 14px; color: var(--fintech-text-secondary); max-width: 480px; }
      .state-icon { font-size: 40px; width: 40px; height: 40px; color: var(--fintech-danger); }
      .loading-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0; color: var(--fintech-text-secondary); font-size: 14px; }
      .fintech-btn { border-radius: 24px !important; padding: 8px 24px !important; font-weight: 600 !important; }
      .fintech-btn.primary { background-color: var(--fintech-primary) !important; color: white !important; }
      .spinning { animation: spin 1s linear infinite; }
      @keyframes spin { 100% { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
    `]
})
export class PaymentComponent implements OnInit, OnDestroy {

    userId = '';
    readonly refreshing = signal(false);
    readonly loadError = signal<string | null>(null);
    private transactionsOverview: TransactionsOverview | null = null;

    private route = inject(ActivatedRoute);
    private sessionService = inject(SessionService);
    private destroyRef = inject(DestroyRef);

    ngOnInit() {
        this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.refresh();
            }
        });
    }

    ngOnDestroy() {
        this.unmount();
    }

    async refresh() {
        this.refreshing.set(true);
        this.loadError.set(null);
        this.unmount();
        try {
            await this.initAdyenComponents();
        } catch (err) {
            this.loadError.set(httpErrorMessage(err, 'The transactions component could not be started.'));
        } finally {
            this.refreshing.set(false);
        }
    }

    private unmount() {
        this.transactionsOverview?.unmount();
        this.transactionsOverview = null;
        const container = document.getElementById('transactions-overview-container');
        if (container) container.innerHTML = '';
    }

    private async initAdyenComponents() {
        const core = await AdyenPlatformExperience({
            onSessionCreate: async () => {
                try {
                    const sessionToken = await firstValueFrom(this.sessionService.getPaymentInformation(this.userId));
                    if (!sessionToken) {
                        throw new Error('No session was returned for transactions.');
                    }
                    return {
                        token: sessionToken.token,
                        id: sessionToken.id
                    };
                } catch (err) {
                    // The component requests sessions lazily, after refresh() has returned.
                    this.loadError.set(httpErrorMessage(err, 'Could not start a transactions session.'));
                    throw err;
                }
            }
        });
        this.transactionsOverview = new TransactionsOverview({core});
        this.transactionsOverview.mount('#transactions-overview-container');
    }
}
