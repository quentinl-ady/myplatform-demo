import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { CapturePayload, CheckoutPayment } from '../models';
import { CaptureService } from '../services';
import { MoneyPipe, formatMoney, fromMinorUnits, httpErrorMessage, toMinorUnits } from '../shared';
import {
  commissionWithinAmount,
  createSplitForm,
  describeSplit,
  enableWhen,
  toSplitSettings,
} from '../checkout/advanced-options/advanced-options';
import { SplitFieldsComponent } from '../checkout/advanced-options/split-fields.component';
import { SplitPreviewComponent } from '../checkout/advanced-options/split-preview.component';

export interface CaptureDialogData {
  payment: CheckoutPayment;
  userId: string;
}

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

/** Captures all or part of an authorised payment, optionally with another split. Closes with the updated payment. */
@Component({
  selector: 'app-capture-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MoneyPipe,
    SplitFieldsComponent,
    SplitPreviewComponent,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">Capture payment</h2>
    <mat-dialog-content class="dialog-content">
      <form [formGroup]="form" id="capture-form" class="capture-form" (ngSubmit)="submit()" novalidate>
        <dl class="recap">
          <div class="recap-row">
            <dt>Reference</dt>
            <dd class="mono">{{ payment.merchantReference }}</dd>
          </div>
          <div class="recap-row">
            <dt>Authorised</dt>
            <dd>{{ payment.amount | money:payment.currency }}</dd>
          </div>
          <div class="recap-row" *ngIf="alreadyCaptured > 0">
            <dt>Captured or requested</dt>
            <dd>{{ alreadyCaptured | money:payment.currency }}</dd>
          </div>
          <div class="recap-row">
            <dt>Left to capture</dt>
            <dd>{{ payment.remainingAmount | money:payment.currency }}</dd>
          </div>
        </dl>

        <div class="field">
          <label for="capture-amount">Amount to capture ({{ payment.currency }})</label>
          <div class="amount-row">
            <input id="capture-amount" type="number" inputmode="decimal" class="fintech-input"
                   formControlName="amount" min="0.01" [max]="maxAmount" step="0.01"
                   [attr.aria-invalid]="!!amountError"
                   [attr.aria-describedby]="amountError ? 'capture-amount-error' : 'capture-amount-help'" />
            <button type="button" class="text-btn" *ngIf="!isFullAmount" (click)="useFullAmount()">Full amount</button>
          </div>
          <span class="helper-text error" id="capture-amount-error" *ngIf="amountError as error">{{ error }}</span>
          <span class="helper-text" id="capture-amount-help" *ngIf="!amountError">{{ amountHelp }}</span>
        </div>

        <fieldset class="split-section">
          <legend>Split</legend>
          <mat-slide-toggle formControlName="customSplit">Use another split for this capture</mat-slide-toggle>
          <ng-container *ngIf="!customSplit">
            <p class="helper-text">{{ currentSplit }}</p>
            <app-split-preview *ngIf="payment.splitSettings as settings" [settings]="settings"
                               [currency]="payment.currency" [amount]="captureAmount"
                               [paymentAmount]="payment.amount" label="Split of this capture"></app-split-preview>
          </ng-container>
          <app-split-fields *ngIf="customSplit" [group]="splitGroup" [currency]="payment.currency"
                            [amount]="captureAmount" idPrefix="capture-split"></app-split-fields>
        </fieldset>

        <p class="dialog-error" role="alert" *ngIf="error() as message">{{ message }}</p>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="dialog-actions">
      <button type="button" class="dialog-btn secondary" mat-dialog-close [disabled]="submitting()">Close</button>
      <button type="submit" form="capture-form" class="dialog-btn primary" [disabled]="submitting()">
        <mat-spinner *ngIf="submitting()" diameter="16" aria-hidden="true"></mat-spinner>
        <span>{{ submitting() ? 'Capturing…' : submitLabel }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../checkout/advanced-options/form-fields.css'],
  styles: [`
    .dialog-title {
      font-family: var(--fintech-font);
      font-weight: 700;
      color: var(--fintech-text);
    }
    .capture-form { display: flex; flex-direction: column; gap: 18px; padding-top: 4px; }
    .recap {
      margin: 0;
      padding: 8px 16px;
      background: var(--fintech-bg);
      border-radius: 12px;
    }
    .recap-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 0;
      font-size: 14px;
    }
    .recap-row + .recap-row { border-top: 1px solid var(--fintech-border); }
    .recap-row dt { color: var(--fintech-text-secondary); }
    .recap-row dd { margin: 0; font-weight: 600; color: var(--fintech-text); text-align: right; word-break: break-all; }
    .recap-row dd.mono { font-family: var(--fintech-font-mono); font-size: 13px; }
    .amount-row { display: flex; align-items: center; gap: 12px; width: 100%; }
    .amount-row .fintech-input { max-width: 200px; }
    .text-btn {
      border: none;
      background: none;
      padding: 4px 0;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--fintech-text);
      text-decoration: underline;
      cursor: pointer;
    }
    .split-section {
      margin: 0;
      padding: 16px 0 0;
      border: none;
      border-top: 1px solid var(--fintech-border);
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .split-section legend {
      float: left;
      width: 100%;
      padding: 0;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--fintech-text-secondary);
    }
    .split-section .helper-text { margin: 0; }
    .dialog-error {
      margin: 0;
      padding: 10px 14px;
      border-radius: 10px;
      background: var(--fintech-danger-bg);
      color: #a32020;
      font-size: 13px;
      line-height: 1.45;
    }
    .dialog-actions { gap: 8px; padding: 8px 24px 20px; }
    .dialog-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: none;
      border-radius: 24px;
      padding: 10px 24px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      background: var(--fintech-primary);
      color: #fff;
    }
    .dialog-btn.secondary { background: var(--fintech-bg); color: var(--fintech-text); }
    .dialog-btn:disabled { opacity: 0.6; cursor: default; }
    .dialog-btn mat-spinner { --mdc-circular-progress-active-indicator-color: currentColor; }
  `]
})
export class CaptureDialogComponent {
  private readonly data: CaptureDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CaptureDialogComponent, CheckoutPayment>>(MatDialogRef);
  private readonly captureService = inject(CaptureService);
  private readonly fb = inject(FormBuilder);

  readonly payment = this.data.payment;
  readonly maxAmount = fromMinorUnits(this.payment.remainingAmount, this.payment.currency);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      amount: [this.maxAmount as number | null, (control: AbstractControl) => this.validateAmount(control)],
      customSplit: [false],
      split: createSplitForm(this.fb, this.payment.splitSettings, this.payment.currency),
    }, { validators: commissionWithinAmount('amount', 'split') });
    enableWhen(this.form.get('customSplit')!, this.form.get('split')!);
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null));
  }

  get alreadyCaptured(): number {
    return this.payment.capturedAmount + this.payment.pendingCaptureAmount;
  }

  get customSplit(): boolean {
    return !!this.form.get('customSplit')?.value;
  }

  get splitGroup(): FormGroup {
    return this.form.get('split') as FormGroup;
  }

  /** Minor units, or null while the amount isn't valid. */
  get captureAmount(): number | null {
    const control = this.form.get('amount');
    return control?.valid ? toMinorUnits(Number(control.value), this.payment.currency) : null;
  }

  get isFullAmount(): boolean {
    return this.captureAmount === this.payment.remainingAmount;
  }

  get amountError(): string | null {
    const control = this.form.get('amount');
    return control && (control.touched || control.dirty) ? control.errors?.['amount'] ?? null : null;
  }

  get amountHelp(): string {
    if (this.alreadyCaptured > 0) {
      return 'Adyen only accepts another capture when multiple partial captures are enabled on the merchant account. Otherwise, the rest was released after the first capture.';
    }
    return this.isFullAmount
      ? 'The whole amount is captured.'
      : 'By default, Adyen releases the rest of the authorisation after a partial capture. Ask Adyen Support to enable multiple partial captures to capture it later.';
  }

  get currentSplit(): string {
    const { splitMode, splitSettings, currency, amount } = this.payment;
    switch (splitMode) {
      case 'CUSTOM':
      case 'MARKETPLACE_DEFAULT': {
        const prorated = splitSettings?.commissionType === 'FIXED' && this.captureAmount !== null && this.captureAmount !== amount;
        const label = splitMode === 'CUSTOM' ? 'Split of the payment' : 'Default split';
        return `${label}: ${describeSplit(splitSettings, currency)}.${prorated ? ' The fixed commission is prorated to the captured amount.' : ''}`;
      }
      case 'STORE_PROFILE':
        return 'The split configuration of the store applies to the captured amount.';
      default:
        return 'No split instructions: the captured amount goes to the liable balance account.';
    }
  }

  get submitLabel(): string {
    const amount = this.captureAmount;
    return amount !== null ? `Capture ${formatMoney(amount, this.payment.currency)}` : 'Capture';
  }

  useFullAmount(): void {
    const control = this.form.get('amount');
    control?.setValue(this.maxAmount);
    control?.markAsDirty();
  }

  submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      // A commission higher than the amount is already reported under the split preview.
      this.form.markAllAsTouched();
      return;
    }

    const currency = this.payment.currency;
    const payload: CapturePayload = {
      userId: this.data.userId,
      amount: toMinorUnits(Number(this.form.get('amount')?.value), currency),
      split: this.customSplit ? toSplitSettings(this.splitGroup, currency) : null,
    };

    this.error.set(null);
    this.submitting.set(true);
    this.dialogRef.disableClose = true;
    this.captureService.capture(this.payment.id, payload).subscribe({
      next: (updated) => this.dialogRef.close(updated),
      error: (err) => {
        this.error.set(httpErrorMessage(err, "Couldn't capture the payment. Try again."));
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
      }
    });
  }

  private validateAmount(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    const value = Number(raw);
    if (raw === null || raw === '' || !(value > 0)) {
      return { amount: 'Enter an amount greater than 0.' };
    }
    if (!TWO_DECIMALS.test(String(raw))) {
      return { amount: 'Use up to 2 decimals.' };
    }
    if (toMinorUnits(value, this.payment.currency) > this.payment.remainingAmount) {
      return { amount: `Enter at most ${formatMoney(this.payment.remainingAmount, this.payment.currency)}, the amount left to capture.` };
    }
    return null;
  }
}
