import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CommissionType, FeeAllocation, SplitSettings } from '../../models';
import { toSplitSettings } from './advanced-options';
import { SplitPreviewComponent } from './split-preview.component';

/** Commission (percentage or fixed) and fee allocation of a single-seller split, with a live preview. */
@Component({
  selector: 'app-split-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonToggleModule, SplitPreviewComponent],
  template: `
    <div class="split-fields" [formGroup]="group">
      <div class="field">
        <span class="field-label" [id]="idPrefix + '-type-label'">Platform commission</span>
        <mat-button-toggle-group formControlName="commissionType" appearance="standard" class="choice-toggle"
                                 [attr.aria-labelledby]="idPrefix + '-type-label'">
          <mat-button-toggle value="PERCENTAGE">Percentage</mat-button-toggle>
          <mat-button-toggle value="FIXED">Fixed amount</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="field" *ngIf="type === 'PERCENTAGE'">
        <label [for]="idPrefix + '-percentage'">Commission (%)</label>
        <input [id]="idPrefix + '-percentage'" type="number" inputmode="decimal" class="fintech-input"
               formControlName="commissionPercentage" min="0" max="100" step="0.01" placeholder="e.g. 10"
               [attr.aria-invalid]="!!fieldError('commissionPercentage')"
               [attr.aria-describedby]="fieldError('commissionPercentage') ? idPrefix + '-percentage-error' : null" />
        <span class="helper-text error" [id]="idPrefix + '-percentage-error'" *ngIf="fieldError('commissionPercentage') as error">{{ error }}</span>
      </div>

      <div class="field" *ngIf="type === 'FIXED'">
        <label [for]="idPrefix + '-amount'">Commission ({{ currency }})</label>
        <input [id]="idPrefix + '-amount'" type="number" inputmode="decimal" class="fintech-input"
               formControlName="commissionAmount" min="0" step="0.01" placeholder="e.g. 2.50"
               [attr.aria-invalid]="!!fieldError('commissionAmount')"
               [attr.aria-describedby]="fieldError('commissionAmount') ? idPrefix + '-amount-error' : null" />
        <span class="helper-text error" [id]="idPrefix + '-amount-error'" *ngIf="fieldError('commissionAmount') as error">{{ error }}</span>
      </div>

      <div class="field">
        <span class="field-label" [id]="idPrefix + '-fees-label'">Payment fees paid by</span>
        <mat-button-toggle-group formControlName="feeAllocation" appearance="standard" class="choice-toggle"
                                 [attr.aria-labelledby]="idPrefix + '-fees-label'"
                                 [attr.aria-describedby]="idPrefix + '-fees-help'">
          <mat-button-toggle value="PLATFORM">Platform</mat-button-toggle>
          <mat-button-toggle value="SUB_MERCHANT">Sub-merchant</mat-button-toggle>
        </mat-button-toggle-group>
        <span class="helper-text" [id]="idPrefix + '-fees-help'">{{ feeHelp }}</span>
      </div>

      <app-split-preview *ngIf="settings as s" [settings]="s" [currency]="currency" [amount]="amount"></app-split-preview>
    </div>
  `,
  styleUrls: ['./form-fields.css'],
  styles: [`
    .split-fields { display: flex; flex-direction: column; gap: 14px; }
  `]
})
export class SplitFieldsComponent {
  @Input({ required: true }) group!: FormGroup;
  @Input({ required: true }) currency!: string;
  /** Minor units the split applies to. The preview is hidden without it. */
  @Input() amount: number | null = null;
  /** Prefix of the element ids; must be unique on the page. */
  @Input({ required: true }) idPrefix!: string;

  get type(): CommissionType {
    return this.group.get('commissionType')?.value;
  }

  get feeAllocation(): FeeAllocation {
    return this.group.get('feeAllocation')?.value;
  }

  get feeHelp(): string {
    return this.feeAllocation === 'SUB_MERCHANT'
      ? "Interchange, scheme and Adyen fees are deducted from the sub-merchant's balance account."
      : "Interchange, scheme and Adyen fees are booked to the platform's liable balance account.";
  }

  /** Null while a field is invalid, so the preview is hidden. */
  get settings(): SplitSettings | null {
    return this.group.invalid ? null : toSplitSettings(this.group, this.currency);
  }

  fieldError(key: 'commissionPercentage' | 'commissionAmount'): string | null {
    const control = this.group.get(key);
    if (!control || !(control.touched || control.dirty)) return null;
    return this.group.errors?.[key] ?? null;
  }
}
