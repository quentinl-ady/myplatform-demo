import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { MaterialModule } from '../material.module';
import { PageTitleStrategy } from '../layout/page-title.strategy';

type ResultStatus = 'success' | 'pending' | 'failed' | 'error';

interface ResultView {
  icon: string;
  title: string;
  message: string;
}

interface ResultAction {
  label: string;
  link: string[];
  primary: boolean;
}

const VIEWS: Record<ResultStatus, ResultView> = {
  success: {
    icon: 'check_circle',
    title: 'Payment successful',
    message: 'The payment was authorised.'
  },
  pending: {
    icon: 'schedule',
    title: 'Payment pending',
    message: 'The payment was received and is waiting for confirmation. The final result is sent as a notification.'
  },
  failed: {
    icon: 'cancel',
    title: 'Payment refused',
    message: 'The payment was not completed. No money was taken. You can try again with another payment method.'
  },
  error: {
    icon: 'error',
    title: 'Something went wrong',
    message: 'We could not process the payment. Please try again.'
  }
};

const SOURCES: Record<string, string> = {
  'checkout': 'Back to Checkout',
  'issuing-checkout': 'Back to Test Issued Cards'
};

const REASON_TO_STATUS: Record<string, ResultStatus> = {
  authorised: 'success',
  pending: 'pending',
  received: 'pending',
  refused: 'failed',
  cancelled: 'failed',
  error: 'error'
};

function hasKey(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

@Component({
  selector: 'app-payment-result',
  standalone: true,
  imports: [CommonModule, RouterLink, MaterialModule],
  template: `
    <main class="result-page">
      <section class="result-card" [attr.data-status]="status" aria-labelledby="result-title">
        <div class="result-icon" aria-hidden="true">
          <mat-icon>{{ view.icon }}</mat-icon>
        </div>
        <h1 id="result-title">{{ view.title }}</h1>
        <p class="result-message">{{ view.message }}</p>

        <dl class="result-reason" *ngIf="reason">
          <dt>Result</dt>
          <dd>{{ reason }}</dd>
        </dl>

        <div class="result-actions">
          <a *ngFor="let action of actions"
             [routerLink]="action.link"
             class="result-btn"
             [class.primary]="action.primary">
            {{ action.label }}
          </a>
        </div>
      </section>
    </main>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      background: var(--fintech-bg);
    }
    .result-page {
      flex: 1 0 auto;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .result-card {
      width: 100%;
      max-width: 480px;
      box-sizing: border-box;
      background: var(--fintech-surface);
      border: 1px solid var(--fintech-border);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
      padding: 40px 32px;
      text-align: center;
    }
    .result-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--fintech-bg);
      color: var(--fintech-text);
    }
    .result-icon mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
    }
    [data-status="success"] .result-icon { background: var(--fintech-success-bg); color: var(--fintech-success); }
    [data-status="pending"] .result-icon { background: var(--fintech-warning-bg); color: var(--fintech-warning); }
    [data-status="failed"] .result-icon,
    [data-status="error"] .result-icon { background: var(--fintech-danger-bg); color: var(--fintech-danger); }
    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--fintech-text);
      margin: 0 0 8px;
    }
    .result-message {
      font-size: 15px;
      line-height: 1.5;
      color: var(--fintech-text-secondary);
      margin: 0;
    }
    .result-reason {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin: 24px 0 0;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--fintech-bg);
      font-size: 14px;
      text-align: left;
    }
    .result-reason dt {
      color: var(--fintech-text-secondary);
    }
    .result-reason dd {
      margin: 0;
      font-weight: 600;
      color: var(--fintech-text);
      overflow-wrap: anywhere;
      text-align: right;
    }
    .result-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 32px;
    }
    .result-btn {
      display: block;
      padding: 12px 24px;
      border-radius: 24px;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid var(--fintech-border);
      background: var(--fintech-surface);
      color: var(--fintech-text);
      transition: background 0.2s;
    }
    .result-btn:hover {
      background: var(--fintech-bg);
    }
    .result-btn.primary {
      background: var(--fintech-primary);
      border-color: var(--fintech-primary);
      color: #fff;
    }
    .result-btn.primary:hover {
      opacity: 0.9;
    }
    @media (max-width: 480px) {
      .result-card {
        padding: 32px 20px;
      }
    }
  `]
})
export class PaymentResultComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private titleStrategy = inject(PageTitleStrategy);

  status: ResultStatus = 'error';
  view: ResultView = VIEWS.error;
  reason = '';
  actions: ResultAction[] = [];

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, query]) => {
      this.reason = (query.get('reason') || '').trim();
      this.status = this.resolveStatus(params.get('status'), this.reason);
      this.view = VIEWS[this.status];
      this.actions = this.buildActions(query.get('userId'), query.get('source'));
      this.titleStrategy.setPageTitle(this.view.title);
    });
  }

  private resolveStatus(param: string | null, reason: string): ResultStatus {
    const fromParam = (param || '').toLowerCase();
    if (hasKey(VIEWS, fromParam)) {
      return fromParam as ResultStatus;
    }
    const fromReason = reason.toLowerCase();
    return hasKey(REASON_TO_STATUS, fromReason) ? REASON_TO_STATUS[fromReason] : 'error';
  }

  private buildActions(userId: string | null, source: string | null): ResultAction[] {
    if (!userId) {
      return [{ label: 'Back to home', link: ['/'], primary: true }];
    }
    const actions: ResultAction[] = [];
    if (source && hasKey(SOURCES, source)) {
      actions.push({ label: SOURCES[source], link: ['/', userId, source], primary: true });
    }
    actions.push({ label: 'Go to Onboarding', link: ['/', userId, 'dashboard'], primary: actions.length === 0 });
    return actions;
  }
}
