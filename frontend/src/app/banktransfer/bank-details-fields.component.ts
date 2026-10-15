import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BankAccountFormat, TestAccount } from '../models';
import { BankDetailsCheck, BankField, bankFieldError } from './bank-details';

interface FieldMeta {
  field: BankField;
  label: string;
  placeholder: string;
  hint: string;
  inputMode: 'text' | 'numeric';
}

const FIELDS: Record<BankAccountFormat, FieldMeta[]> = {
  iban: [
    { field: 'iban', label: 'IBAN', placeholder: 'e.g. FR76 3000 6000 0112 3456 7890 189', hint: 'Starts with the 2-letter country code. Spaces are optional.', inputMode: 'text' }
  ],
  accountNumberRoutingNumber: [
    { field: 'accountNumber', label: 'Account number', placeholder: 'e.g. 10220001111', hint: '4 to 17 digits.', inputMode: 'numeric' },
    { field: 'routingNumber', label: 'ABA routing number', placeholder: 'e.g. 121000248', hint: '9 digits, identifies the US bank.', inputMode: 'numeric' }
  ],
  accountNumberSortCode: [
    { field: 'accountNumber', label: 'Account number', placeholder: 'e.g. 50000000', hint: '8 digits.', inputMode: 'numeric' },
    { field: 'sortCode', label: 'Sort code', placeholder: 'e.g. 20-26-78', hint: '6 digits, identifies the UK bank. Dashes are optional.', inputMode: 'numeric' }
  ]
};

/** Beneficiary bank fields of the format required by the recipient country, with their check status. */
@Component({
  selector: 'app-bank-details-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="bank-fields" [formGroup]="form" *ngIf="check.format as format">

      <button type="button" mat-stroked-button class="test-account-btn" *ngIf="testAccount" (click)="fillTestAccount()">
        <mat-icon aria-hidden="true">science</mat-icon>
        Use test account
      </button>

      <div class="form-group" *ngFor="let meta of fieldsOf(format)">
        <label [for]="idPrefix + '-' + meta.field">{{ meta.label }}</label>
        <input type="text" class="fintech-input" [id]="idPrefix + '-' + meta.field" [formControlName]="meta.field"
               [placeholder]="meta.placeholder" [attr.inputmode]="meta.inputMode" autocomplete="off" spellcheck="false"
               [attr.aria-invalid]="!!errorOf(meta.field)" [attr.aria-describedby]="idPrefix + '-' + meta.field + '-hint'" />
        <span class="field-hint" [class.field-error]="!!errorOf(meta.field)" [id]="idPrefix + '-' + meta.field + '-hint'">
          {{ errorOf(meta.field) || meta.hint }}
        </span>
      </div>

      <div class="validation-status" role="status" *ngIf="check.checking || check.valid || check.error">
        <ng-container *ngIf="check.checking">
          <mat-spinner diameter="16" aria-hidden="true"></mat-spinner>
          <span class="pending-text">Checking the bank details...</span>
        </ng-container>
        <ng-container *ngIf="!check.checking && check.valid">
          <mat-icon class="status-icon success" aria-hidden="true">check_circle</mat-icon>
          <span class="success-text">Bank details verified</span>
        </ng-container>
        <ng-container *ngIf="!check.checking && check.error">
          <mat-icon class="status-icon error" aria-hidden="true">error</mat-icon>
          <span class="error-text">{{ check.error }}</span>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .bank-fields { display: flex; flex-direction: column; gap: 16px; }
    .test-account-btn { align-self: flex-start; border-radius: 24px !important; font-weight: 600 !important; letter-spacing: 0 !important; background: var(--fintech-bg) !important; color: var(--fintech-text) !important; border: none !important; }
    .form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--fintech-text-secondary); margin-bottom: 6px; }
    .fintech-input { width: 100%; padding: 14px 16px; border: 1px solid var(--fintech-border); border-radius: 10px; font-size: 15px; box-sizing: border-box; background: var(--fintech-surface); transition: border-color 0.2s; font-family: var(--fintech-font-mono); }
    .fintech-input:focus { outline: none; border-color: var(--fintech-primary); }
    .fintech-input[aria-invalid="true"] { border-color: var(--fintech-danger); }
    .field-hint { display: block; margin-top: 6px; font-size: 12px; color: var(--fintech-text-secondary); }
    .field-hint.field-error { color: var(--fintech-danger); }
    .validation-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; margin-top: -4px; }
    .status-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .status-icon.success, .success-text { color: #0a8f3f; }
    .status-icon.error, .error-text { color: var(--fintech-danger); }
    .pending-text { color: var(--fintech-text-secondary); }
  `]
})
export class BankDetailsFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input({ required: true }) check!: BankDetailsCheck;
  @Input() testAccount: TestAccount | null = null;
  @Input() idPrefix = 'bank';

  fieldsOf(format: BankAccountFormat): FieldMeta[] {
    return FIELDS[format];
  }

  errorOf(field: BankField): string {
    return bankFieldError(this.form.get(field));
  }

  fillTestAccount() {
    if (!this.testAccount) return;
    this.form.patchValue(this.testAccount);
    Object.keys(this.testAccount).forEach(field => this.form.get(field)?.markAsDirty());
  }
}
