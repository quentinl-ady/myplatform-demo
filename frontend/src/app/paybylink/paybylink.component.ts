import {Component, OnInit, OnDestroy, signal, inject, DestroyRef} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import { firstValueFrom } from 'rxjs';
import {
    AdyenPlatformExperience,
    PaymentLinksOverview
} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";
import {InlineAlertComponent, httpErrorMessage} from '../shared';

@Component({
    selector: 'app-paybylink',
    standalone: true,
    imports: [CommonModule, MaterialModule, InlineAlertComponent],
    template: `
    <div class="fintech-wrapper">
      <div class="header-section">
        <div class="header-row">
          <div>
            <h1>Pay by Link</h1>
            <p>Create and manage payment links for your customers.</p>
          </div>
          <button mat-icon-button type="button" class="refresh-btn" (click)="refresh()" [disabled]="refreshing()"
                  matTooltip="Refresh payment links" aria-label="Refresh payment links">
            <mat-icon [class.spinning]="refreshing()" aria-hidden="true">refresh</mat-icon>
          </button>
        </div>
      </div>

      <app-inline-alert *ngIf="loadError() as error" title="Unable to load payment links"
                        actionLabel="Try again" (action)="refresh()">{{ error }}</app-inline-alert>

      <mat-card class="component-card" [hidden]="!!loadError()" [attr.aria-busy]="refreshing()">
        <div class="loading-state" *ngIf="refreshing()" role="status">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Loading payment links…</span>
        </div>
        <div id="payment-links-overview-container" class="fintech-light-island component-island"></div>
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
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--fintech-text);
        margin: 0 0 8px 0;
        letter-spacing: -0.5px;
      }
      .header-section p {
        color: var(--fintech-text-secondary);
        font-size: 0.9375rem;
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
      /* Adyen components only ship light styles: they sit on a light panel in dark mode too. */
      .component-island { border-radius: 12px; padding: 16px; }
      .component-island:empty { display: none; }
      .loading-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0; color: var(--fintech-text-secondary); font-size: 0.875rem; }
      .spinning { animation: spin 1s linear infinite; }
      @keyframes spin { 100% { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
    `]
})
export class PayByLinkComponent implements OnInit, OnDestroy {

    userId = '';
    readonly refreshing = signal(false);
    readonly loadError = signal<string | null>(null);
    private paymentLinksOverview: PaymentLinksOverview | null = null;

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
            this.loadError.set(httpErrorMessage(err, 'Unable to start the payment links component. Try again.'));
        } finally {
            this.refreshing.set(false);
        }
    }

    private unmount() {
        this.paymentLinksOverview?.unmount();
        this.paymentLinksOverview = null;
        const container = document.getElementById('payment-links-overview-container');
        if (container) container.innerHTML = '';
    }

    private async initAdyenComponents() {
        const core = await AdyenPlatformExperience({
            onSessionCreate: async () => {
                try {
                    const sessionToken = await firstValueFrom(this.sessionService.getPayByLinkInformation(this.userId));
                    if (!sessionToken) {
                        throw new Error('No session was returned for payment links.');
                    }
                    return {
                        token: sessionToken.token,
                        id: sessionToken.id
                    };
                } catch (err) {
                    // The component requests sessions lazily, after refresh() has returned.
                    this.loadError.set(httpErrorMessage(err, 'Unable to start a payment links session. Try again.'));
                    throw err;
                }
            }
        });
        this.paymentLinksOverview = new PaymentLinksOverview({core});
        this.paymentLinksOverview.mount('#payment-links-overview-container');
    }
}
