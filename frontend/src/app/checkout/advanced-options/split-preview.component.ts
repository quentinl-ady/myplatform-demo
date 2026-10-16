import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SplitSettings } from '../../models';
import { MoneyPipe } from '../../shared';
import { SplitPreview, previewSplit } from './advanced-options';

/** What the sub-merchant and the platform receive for an amount, with the split settings. */
@Component({
  selector: 'app-split-preview',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
  template: `
    <ng-container *ngIf="preview as p">
      <dl class="split-preview" [attr.aria-label]="label">
        <div class="preview-row">
          <dt>{{ settings.feeAllocation === 'SUB_MERCHANT' ? 'Sub-merchant receives (before fees)' : 'Sub-merchant receives' }}</dt>
          <dd>{{ p.seller | money:currency }}</dd>
        </div>
        <div class="preview-row">
          <dt>Platform commission</dt>
          <dd>{{ p.commission | money:currency }}</dd>
        </div>
        <div class="preview-row">
          <dt>Payment fees</dt>
          <dd>{{ settings.feeAllocation === 'SUB_MERCHANT' ? 'Deducted from the sub-merchant' : 'Paid by the platform' }}</dd>
        </div>
      </dl>
      <span class="preview-error" role="alert" *ngIf="p.error">{{ p.error }}</span>
    </ng-container>
  `,
  styles: [`
    :host { display: block; }
    .split-preview {
      margin: 0;
      padding: 8px 14px;
      background: var(--fintech-bg);
      border-radius: 10px;
    }
    .preview-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      font-size: 13px;
    }
    .preview-row + .preview-row { border-top: 1px solid var(--fintech-border); }
    .preview-row dt { color: var(--fintech-text-secondary); }
    .preview-row dd { margin: 0; font-weight: 600; color: var(--fintech-text); text-align: right; }
    .preview-error {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      color: var(--fintech-danger);
    }
  `]
})
export class SplitPreviewComponent {
  @Input({ required: true }) settings!: SplitSettings;
  @Input({ required: true }) currency!: string;
  /** Minor units the split applies to. Nothing is shown without it. */
  @Input() amount: number | null = null;
  /** Minor units a fixed commission is defined for, when only part of it is captured. */
  @Input() paymentAmount: number | null = null;
  @Input() label = 'Split preview';

  get preview(): SplitPreview | null {
    if (this.amount == null) return null;
    return previewSplit(this.settings, this.amount, this.paymentAmount ?? this.amount);
  }
}
