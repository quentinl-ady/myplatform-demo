import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BankAccountFormat, BillSettings, RecipientCountry, Supplier, SupplierRequest, VopScenario } from '../models';
import { SupplierService } from '../services';
import { InlineAlertComponent, httpErrorMessage } from '../shared';
import { compactIban, digitsOnly, formatIban, formatSortCode, normalizeBankDetails } from '../banktransfer/bank-details';
import { countryName, customerCountries } from '../invoices/invoice-view';
import { VOP_SCENARIOS } from './bill-view';

export interface SupplierDialogData {
  userId: string;
  settings: BillSettings;
  /** Edits this supplier; creates one otherwise. */
  supplier?: Supplier;
}

type BankField = 'iban' | 'accountNumber' | 'sortCode' | 'routingNumber';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const FIELDS: Record<BankAccountFormat, BankField[]> = {
  iban: ['iban'],
  accountNumberSortCode: ['accountNumber', 'sortCode'],
  accountNumberRoutingNumber: ['accountNumber', 'routingNumber'],
};

const LABELS: Record<BankField, string> = {
  iban: 'IBAN',
  accountNumber: 'Account number',
  sortCode: 'Sort code',
  routingNumber: 'ABA routing number',
};

const MISSING: Record<BankField, string> = {
  iban: 'Enter the IBAN.',
  accountNumber: 'Enter the account number too, or leave the bank details empty.',
  sortCode: 'Enter the sort code too, or leave the bank details empty.',
  routingNumber: 'Enter the ABA routing number too, or leave the bank details empty.',
};

/** Fails with the message the field shows. */
function rule(test: (value: string) => boolean, message: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => test(String(control.value ?? '').trim()) ? null : { message };
}

/** Empty is valid: without bank details, the supplier is paid by card. */
function bankValidator(format: BankAccountFormat, field: BankField): ValidatorFn {
  switch (field) {
    case 'iban':
      return rule(v => !v || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compactIban(v)),
        'Enter an IBAN: 2 letters, 2 digits, then up to 30 letters or digits.');
    case 'sortCode':
      return rule(v => !v || /^\d{6}$/.test(digitsOnly(v)), 'Enter the 6-digit sort code.');
    case 'routingNumber':
      return rule(v => !v || /^\d{9}$/.test(digitsOnly(v)), 'Enter the 9-digit ABA routing number.');
    case 'accountNumber':
      return format === 'accountNumberSortCode'
        ? rule(v => !v || /^\d{8}$/.test(digitsOnly(v)), 'Enter the 8-digit account number.')
        : rule(v => !v || /^\d{4,17}$/.test(digitsOnly(v)), 'Enter the account number: 4 to 17 digits.');
  }
}

function displayValue(field: BankField, value: string | null | undefined): string {
  switch (field) {
    case 'iban':
      return value ? formatIban(value) : '';
    case 'sortCode':
      return value ? formatSortCode(value) : '';
    default:
      return value ?? '';
  }
}

/** Creates or edits a supplier. Closes with the saved supplier. */
@Component({
  selector: 'app-supplier-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, InlineAlertComponent],
  template: `
    <h2 mat-dialog-title class="dialog-title">{{ editing ? 'Edit supplier' : 'New supplier' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="supplier-form" class="dialog-form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="supplier-name">Name</label>
          <input id="supplier-name" class="fintech-input" formControlName="name" autocomplete="organization" maxlength="100"
                 [attr.aria-invalid]="!!errorOf('name')"
                 [attr.aria-describedby]="errorOf('name') ? 'supplier-name-error' : 'supplier-name-help'" />
          <span class="helper-text error" id="supplier-name-error" *ngIf="errorOf('name') as error">{{ error }}</span>
          <span class="helper-text" id="supplier-name-help" *ngIf="!errorOf('name')">As on its bank account.</span>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="supplier-email">Email address <span class="optional">(optional)</span></label>
            <input id="supplier-email" type="email" class="fintech-input" formControlName="email" autocomplete="email" maxlength="254"
                   [attr.aria-invalid]="!!errorOf('email')"
                   [attr.aria-describedby]="errorOf('email') ? 'supplier-email-error' : null" />
            <span class="helper-text error" id="supplier-email-error" *ngIf="errorOf('email') as error">{{ error }}</span>
          </div>
          <div class="field">
            <label for="supplier-vat">{{ taxLabel }} number <span class="optional">(optional)</span></label>
            <input id="supplier-vat" class="fintech-input" formControlName="vatNumber" maxlength="30" autocapitalize="characters" />
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="supplier-country">Country</label>
            <select id="supplier-country" class="fintech-input" formControlName="country" autocomplete="country"
                    [attr.aria-invalid]="!!errorOf('country')"
                    [attr.aria-describedby]="errorOf('country') ? 'supplier-country-error' : null">
              <option value="" disabled>Choose a country</option>
              <option *ngFor="let c of countries" [value]="c.code">{{ c.name }}</option>
            </select>
            <span class="helper-text error" id="supplier-country-error" *ngIf="errorOf('country') as error">{{ error }}</span>
          </div>
          <div class="field">
            <label for="supplier-category">Default category <span class="optional">(optional)</span></label>
            <select id="supplier-category" class="fintech-input" formControlName="defaultCategory" aria-describedby="supplier-category-help">
              <option value="">No default</option>
              <option *ngFor="let c of settings.categories" [value]="c.code">{{ c.code }} · {{ c.name }}</option>
            </select>
            <span class="helper-text" id="supplier-category-help">Prefills the expense account of its bills.</span>
          </div>
        </div>

        <fieldset class="bank-section" *ngIf="format; else noTransfers">
          <legend>Bank details <span class="optional">(optional)</span></legend>
          <div [class.field-row]="fields.length > 1">
            <div class="field" *ngFor="let field of fields">
              <label [for]="'supplier-' + field">{{ labels[field] }}</label>
              <input [id]="'supplier-' + field" class="fintech-input" [formControlName]="field" autocomplete="off" spellcheck="false"
                     [attr.inputmode]="field === 'iban' ? null : 'numeric'"
                     [attr.autocapitalize]="field === 'iban' ? 'characters' : null"
                     [attr.maxlength]="field === 'iban' ? 42 : 20"
                     [attr.aria-invalid]="!!errorOf(field)"
                     [attr.aria-describedby]="errorOf(field) ? 'supplier-' + field + '-error' : 'supplier-bank-help'" />
              <span class="helper-text error" [id]="'supplier-' + field + '-error'" *ngIf="errorOf(field) as error">{{ error }}</span>
            </div>
          </div>
          <span class="helper-text" id="supplier-bank-help">Without bank details, its bills are paid by card.</span>
          <button type="button" class="text-btn" *ngIf="testAccount() as test" (click)="useTestAccount(test)">
            <mat-icon aria-hidden="true">science</mat-icon>Use the test account of a bank in {{ countryName(test.countryCode) }}
          </button>

          <div class="field" *ngIf="vopAvailable">
            <label for="supplier-vop">Verification of Payee result <span class="optional">(test)</span></label>
            <select id="supplier-vop" class="fintech-input" formControlName="vopScenario" aria-describedby="supplier-vop-help">
              <option *ngFor="let scenario of vopScenarios" [value]="scenario.value">{{ scenario.label }}</option>
            </select>
            <span class="helper-text" id="supplier-vop-help">The result its checks return in test.</span>
          </div>
        </fieldset>
        <ng-template #noTransfers>
          <p class="dialog-note">Transfers aren't available from a {{ settings.currency }} account: its bills are paid by card.</p>
        </ng-template>

        <app-inline-alert *ngIf="error() as message" [title]="editing ? 'Unable to save the supplier' : 'Unable to create the supplier'"
                          [dismissible]="true" (dismiss)="error.set(null)">{{ message }}</app-inline-alert>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="dialog-actions">
      <button type="button" class="dialog-btn secondary" mat-dialog-close [disabled]="submitting()">Cancel</button>
      <button type="submit" form="supplier-form" class="dialog-btn" [disabled]="submitting()">
        <mat-spinner *ngIf="submitting()" diameter="16" aria-hidden="true"></mat-spinner>
        <span>{{ submitting() ? 'Saving…' : (editing ? 'Save supplier' : 'Add supplier') }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../checkout/advanced-options/form-fields.css', '../invoices/dialog.css', './bill-dialogs.css'],
})
export class SupplierDialogComponent {
  private readonly data: SupplierDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<SupplierDialogComponent, Supplier>>(MatDialogRef);
  private readonly supplierService = inject(SupplierService);
  private readonly fb = inject(FormBuilder);

  readonly settings = this.data.settings;
  readonly editing = !!this.data.supplier;
  readonly taxLabel = this.settings.taxLabel;
  /** Set by the currency of the account, not by the country of the supplier. */
  readonly format: BankAccountFormat | null = this.settings.bankAccountFormat ?? null;
  readonly fields: BankField[] = this.format ? FIELDS[this.format] : [];
  readonly labels = LABELS;
  readonly countries = customerCountries(this.data.supplier?.country, this.settings.country);
  readonly vopScenarios = VOP_SCENARIOS;
  readonly vopAvailable = !!this.format && this.settings.recipientCountries
    .some(country => country.bankAccountFormat === this.format && country.payeeVerification);
  readonly countryName = countryName;
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly form: FormGroup;

  private readonly country = signal('');
  /** A bank account Adyen accepts in TEST, in the country of the supplier when there is one. */
  readonly testAccount = computed<RecipientCountry | null>(() => {
    const candidates = this.settings.recipientCountries
      .filter(country => country.bankAccountFormat === this.format && !!country.testAccount);
    const code = this.country();
    return candidates.find(country => country.countryCode === code)
      ?? candidates.find(country => country.countryCode === this.settings.country)
      ?? candidates[0]
      ?? null;
  });

  constructor() {
    const supplier = this.data.supplier;
    const controls: Record<string, unknown> = {
      name: [supplier?.name ?? '', rule(v => !!v, 'Enter the name of the supplier, as on its bank account.')],
      email: [supplier?.email ?? '', rule(v => !v || EMAIL.test(v), 'Enter a valid email address, like name@example.com.')],
      country: [supplier?.country ?? this.settings.country ?? '', rule(v => !!v, 'Choose the country of the supplier.')],
      vatNumber: [supplier?.vatNumber ?? ''],
      defaultCategory: [supplier?.defaultCategory ?? ''],
      vopScenario: [supplier?.vopScenario ?? ''],
    };
    for (const field of this.fields) {
      controls[field] = [displayValue(field, supplier?.[field]), bankValidator(this.format!, field)];
    }
    this.form = this.fb.group(controls, { validators: (group: AbstractControl) => this.validateBank(group) });

    this.country.set(this.form.get('country')?.value ?? '');
    this.form.get('country')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(code => this.country.set(code ?? ''));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null));
  }

  errorOf(name: string): string | null {
    const control = this.form.get(name);
    if (!control || !(control.touched || control.dirty)) return null;
    const message = control.errors?.['message'];
    if (message) return message;
    return this.form.errors?.['bankMissing'] === name ? MISSING[name as BankField] : null;
  }

  useTestAccount(country: RecipientCountry): void {
    const account = country.testAccount;
    if (!account) return;
    for (const field of this.fields) {
      const control = this.form.get(field);
      control?.setValue(displayValue(field, account[field]));
      control?.markAsDirty();
    }
  }

  submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => document.querySelector<HTMLElement>('#supplier-form [aria-invalid="true"]')?.focus());
      return;
    }
    const value = this.form.getRawValue();
    const bank = normalizeBankDetails(this.format, value);
    const request: SupplierRequest = {
      name: String(value.name).trim(),
      email: String(value.email ?? '').trim() || null,
      country: value.country,
      vatNumber: String(value.vatNumber ?? '').trim() || null,
      iban: bank.iban || null,
      accountNumber: bank.accountNumber || null,
      sortCode: bank.sortCode || null,
      routingNumber: bank.routingNumber || null,
      defaultCategory: value.defaultCategory || null,
      vopScenario: (value.vopScenario || null) as VopScenario | null,
    };
    const supplier = this.data.supplier;
    this.error.set(null);
    this.submitting.set(true);
    this.dialogRef.disableClose = true;
    const save$ = supplier
      ? this.supplierService.update(this.data.userId, supplier.id, request)
      : this.supplierService.create(this.data.userId, request);
    save$.subscribe({
      next: saved => this.dialogRef.close(saved),
      error: err => {
        this.error.set(httpErrorMessage(err, 'Unable to save the supplier. Try again.'));
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
      }
    });
  }

  /** Both identifiers of a local account, or none. */
  private validateBank(group: AbstractControl): ValidationErrors | null {
    if (this.fields.length < 2) return null;
    const filled = this.fields.filter(field => String(group.get(field)?.value ?? '').trim());
    if (!filled.length || filled.length === this.fields.length) return null;
    return { bankMissing: this.fields.find(field => !filled.includes(field)) };
  }
}
