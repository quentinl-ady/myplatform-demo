import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MoneyPipe } from '../shared';
import { PaymentOutcome } from './payment-outcome';

const ICONS: Record<PaymentOutcome['kind'], string> = {
  success: 'check_circle',
  pending: 'schedule',
  refused: 'cancel',
  cancelled: 'block',
  error: 'error',
};

@Component({
  selector: 'app-payment-outcome-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule, MoneyPipe],
  template: `
    <div class="outcome" [ngClass]="'outcome-' + outcome.kind" role="status">
      <mat-icon class="outcome-icon" aria-hidden="true">{{ icon }}</mat-icon>
      <h2 class="mat-h3 outcome-title" #title tabindex="-1">{{ outcome.title }}</h2>
      <p class="outcome-message">{{ outcome.message }}</p>

      <dl class="outcome-details" *ngIf="hasDetails">
        <div class="outcome-row" *ngIf="outcome.amount !== undefined && outcome.amount !== null">
          <dt>Amount</dt>
          <dd>{{ outcome.amount | money:outcome.currency }}</dd>
        </div>
        <div class="outcome-row" *ngIf="outcome.reference">
          <dt>Reference</dt>
          <dd class="mono">{{ outcome.reference }}</dd>
        </div>
        <div class="outcome-row" *ngIf="outcome.pspReference">
          <dt>PSP reference</dt>
          <dd class="mono">{{ outcome.pspReference }}</dd>
        </div>
        <div class="outcome-row" *ngIf="outcome.refusalReason">
          <dt>Refusal reason</dt>
          <dd>{{ outcome.refusalReason }}</dd>
        </div>
        <div class="outcome-row" *ngIf="outcome.resultCode">
          <dt>Result code</dt>
          <dd class="mono">{{ outcome.resultCode }}</dd>
        </div>
      </dl>

      <div class="outcome-actions">
        <button type="button" class="outcome-btn secondary" *ngIf="secondaryLabel" (click)="secondary.emit()">
          {{ secondaryLabel }}
        </button>
        <button type="button" class="outcome-btn" [class.primary]="filledPrimary" [class.secondary]="!filledPrimary"
                (click)="primary.emit()">{{ primaryLabel }}</button>
      </div>
    </div>
  `,
  styles: [`
    .outcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 8px 0;
    }
    .outcome-icon { font-size: 3.5rem; width: 3.5rem; height: 3.5rem; margin-bottom: 12px; }
    .outcome-success .outcome-icon { color: var(--fintech-success); }
    .outcome-pending .outcome-icon { color: var(--fintech-warning); }
    .outcome-refused .outcome-icon,
    .outcome-error .outcome-icon { color: var(--fintech-danger); }
    .outcome-cancelled .outcome-icon { color: var(--fintech-text-secondary); }
    .outcome-title {
      margin: 0 0 8px;
      font-size: 1.375rem;
      font-weight: 700;
      color: var(--fintech-text);
    }
    .outcome-title:focus:not(:focus-visible) { outline: none; }
    .outcome-message {
      margin: 0 0 20px;
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--fintech-text-secondary);
    }
    .outcome-details {
      width: 100%;
      margin: 0 0 24px;
      padding: 8px 16px;
      background: var(--fintech-bg);
      border-radius: 12px;
      box-sizing: border-box;
      text-align: left;
    }
    .outcome-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid var(--fintech-border);
      font-size: 0.875rem;
    }
    .outcome-row:last-child { border-bottom: none; }
    .outcome-row dt { color: var(--fintech-text-secondary); }
    .outcome-row dd { margin: 0; font-weight: 600; color: var(--fintech-text); text-align: right; word-break: break-all; }
    .outcome-row dd.mono { font-family: var(--fintech-font-mono); font-size: 0.8125rem; }
    .outcome-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; width: 100%; }
    .outcome-btn {
      flex: 1 1 140px;
      max-width: 220px;
      min-height: 44px;
      padding: 10px 20px;
      border-radius: 24px;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--fintech-primary);
    }
    .outcome-btn.primary { background: var(--fintech-primary); color: var(--fintech-on-primary); }
    .outcome-btn.secondary { background: var(--fintech-surface); color: var(--fintech-text); border-color: var(--fintech-border-strong); }
    .outcome-btn.secondary:hover { border-color: var(--fintech-text); }
  `],
})
export class PaymentOutcomePanelComponent implements AfterViewInit {
  @Input({ required: true }) outcome!: PaymentOutcome;
  @Input() primaryLabel = 'New payment';
  @Input() secondaryLabel?: string;
  @Output() primary = new EventEmitter<void>();
  @Output() secondary = new EventEmitter<void>();

  @ViewChild('title') private title?: ElementRef<HTMLElement>;

  get hasDetails(): boolean {
    const o = this.outcome;
    return (o.amount !== undefined && o.amount !== null) || !!(o.reference || o.pspReference || o.refusalReason || o.resultCode);
  }

  /** After a failure, trying again is offered as a secondary action rather than a filled button. */
  get filledPrimary(): boolean {
    return this.outcome.kind === 'success' || this.outcome.kind === 'pending';
  }

  get icon(): string {
    return ICONS[this.outcome.kind];
  }

  ngAfterViewInit(): void {
    // The Drop-in that had focus is unmounted when the result is shown, so focus would otherwise fall back to <body>.
    this.title?.nativeElement.focus();
  }
}
