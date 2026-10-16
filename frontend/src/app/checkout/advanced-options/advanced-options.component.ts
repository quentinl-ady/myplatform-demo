import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { CaptureMode } from '../../models';
import { MAX_CAPTURE_DELAY_HOURS, describeCaptureMode, describeSplit, toSplitSettings } from './advanced-options';
import { SplitFieldsComponent } from './split-fields.component';

const CAPTURE_HELP: Record<CaptureMode, string> = {
  IMMEDIATE: 'The payment is captured as soon as it is authorised.',
  DELAYED: 'Adyen captures the payment automatically after the delay. Until then, you can capture or cancel it from the Captures page.',
  MANUAL: 'The payment is only authorised. Capture all or part of it, or cancel it, from the Captures page. Card authorisations usually expire after about 7 days.',
};

/** Collapsible capture and split settings of a checkout form (group created with createAdvancedOptionsForm). */
@Component({
  selector: 'app-advanced-options',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonToggleModule, MatIconModule, MatSlideToggleModule, SplitFieldsComponent],
  template: `
    <section class="advanced" [class.open]="open" [formGroup]="group">
      <button type="button" class="advanced-toggle" (click)="open = !open"
              [attr.aria-expanded]="open" [attr.aria-controls]="idPrefix + '-panel'">
        <mat-icon class="advanced-icon" aria-hidden="true">tune</mat-icon>
        <span class="advanced-heading">
          <span class="advanced-title">Advanced options</span>
          <span class="advanced-summary">{{ summary }}</span>
        </span>
        <mat-icon class="advanced-chevron" aria-hidden="true">{{ open ? 'expand_less' : 'expand_more' }}</mat-icon>
      </button>
      <span class="helper-text error collapsed-error" *ngIf="!open && group.invalid">
        Some advanced options are invalid. Open the panel to fix them.
      </span>

      <div class="advanced-body" [id]="idPrefix + '-panel'" [hidden]="!open">
        <fieldset class="advanced-section">
          <legend>Capture</legend>
          <mat-button-toggle-group formControlName="captureMode" appearance="standard" class="choice-toggle"
                                   aria-label="Capture mode" [attr.aria-describedby]="idPrefix + '-capture-help'">
            <mat-button-toggle value="IMMEDIATE">Immediate</mat-button-toggle>
            <mat-button-toggle value="DELAYED">Delayed</mat-button-toggle>
            <mat-button-toggle value="MANUAL">Manual</mat-button-toggle>
          </mat-button-toggle-group>
          <p class="helper-text" [id]="idPrefix + '-capture-help'">{{ captureHelp }}</p>

          <div class="field delay-field" *ngIf="captureMode === 'DELAYED'">
            <label [for]="idPrefix + '-delay'">Capture after (hours)</label>
            <input [id]="idPrefix + '-delay'" type="number" inputmode="numeric" class="fintech-input delay-input"
                   formControlName="captureDelayHours" min="1" [max]="maxDelayHours" step="1" placeholder="e.g. 24"
                   [attr.aria-invalid]="!!delayError"
                   [attr.aria-describedby]="delayError ? idPrefix + '-delay-error' : null" />
            <span class="helper-text error" [id]="idPrefix + '-delay-error'" *ngIf="delayError as error">{{ error }}</span>
          </div>
        </fieldset>

        <fieldset class="advanced-section">
          <legend>Split</legend>
          <mat-slide-toggle formControlName="customSplit">Custom split for this payment</mat-slide-toggle>
          <p class="helper-text" *ngIf="!customSplit">{{ defaultSplit }}</p>
          <app-split-fields *ngIf="customSplit" class="split-fields"
                            [group]="splitGroup" [currency]="currency" [amount]="amount"
                            [idPrefix]="idPrefix + '-split'"></app-split-fields>
        </fieldset>
      </div>
    </section>
  `,
  styleUrls: ['./form-fields.css'],
  styles: [`
    .advanced {
      border: 1px solid var(--fintech-border);
      border-radius: 12px;
      background: var(--fintech-surface);
    }
    .advanced.open { border-color: var(--fintech-text-secondary); }
    .advanced-toggle {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 14px;
      border: none;
      border-radius: 12px;
      background: transparent;
      font: inherit;
      text-align: left;
      cursor: pointer;
      color: var(--fintech-text);
    }
    .advanced-toggle:hover { background: var(--fintech-bg); }
    .advanced-icon { color: var(--fintech-text-secondary); flex-shrink: 0; }
    .advanced-heading { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .advanced-title { font-size: 14px; font-weight: 600; }
    .advanced-summary {
      font-size: 12px;
      color: var(--fintech-text-secondary);
      overflow-wrap: anywhere;
    }
    .advanced-chevron { color: var(--fintech-text-secondary); flex-shrink: 0; }
    .collapsed-error { padding: 0 14px 12px; margin: 0; }
    .advanced-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 14px 16px;
    }
    .advanced-body[hidden] { display: none; }
    .advanced-section {
      margin: 0;
      padding: 0;
      border: none;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .advanced-section + .advanced-section {
      padding-top: 16px;
      border-top: 1px solid var(--fintech-border);
    }
    .advanced-section legend {
      padding: 0;
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--fintech-text-secondary);
    }
    .advanced-section .helper-text { margin: 0; }
    .delay-field { width: 100%; margin-top: 4px; }
    .delay-input { max-width: 160px; }
    .split-fields { display: block; width: 100%; margin-top: 8px; }
  `]
})
export class AdvancedOptionsComponent {
  @Input({ required: true }) group!: FormGroup;
  @Input({ required: true }) currency!: string;
  /** Payment amount in minor units, for the split preview. */
  @Input() amount: number | null = null;
  /** Split applied when no custom split is chosen (see defaultSplitDescription). */
  @Input({ required: true }) defaultSplit!: string;
  /** Prefix of the element ids; must be unique on the page. */
  @Input({ required: true }) idPrefix!: string;

  open = false;
  readonly maxDelayHours = MAX_CAPTURE_DELAY_HOURS;

  get captureMode(): CaptureMode {
    return this.group.get('captureMode')?.value;
  }

  get customSplit(): boolean {
    return !!this.group.get('customSplit')?.value;
  }

  get splitGroup(): FormGroup {
    return this.group.get('split') as FormGroup;
  }

  get captureHelp(): string {
    return CAPTURE_HELP[this.captureMode] ?? CAPTURE_HELP.IMMEDIATE;
  }

  get delayError(): string | null {
    const control = this.group.get('captureDelayHours');
    if (!control || !(control.touched || control.dirty)) return null;
    return this.group.errors?.['captureDelayHours'] ?? null;
  }

  get summary(): string {
    const delay = Number(this.group.get('captureDelayHours')?.value);
    const capture = this.captureMode === 'DELAYED' && this.group.hasError('captureDelayHours')
      ? 'Delayed capture'
      : describeCaptureMode(this.captureMode, delay);
    if (!this.customSplit) return `${capture} · Default split`;
    const split = this.splitGroup.valid ? describeSplit(toSplitSettings(this.splitGroup, this.currency), this.currency) : '';
    return split ? `${capture} · Custom split: ${split}` : `${capture} · Custom split`;
  }
}
