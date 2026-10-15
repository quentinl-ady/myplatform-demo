import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Observable, Subscription, combineLatest, of } from 'rxjs';
import { catchError, debounceTime, filter, map, startWith, switchMap, tap } from 'rxjs/operators';
import { httpErrorMessage } from '../shared';
import { BankAccountFormat, IsBankAccountValidRequest, TransferRouteRequest } from '../models';
import { TransferService } from '../services';

export type BankField = 'iban' | 'accountNumber' | 'routingNumber' | 'sortCode';

export const BANK_FIELDS: BankField[] = ['iban', 'accountNumber', 'routingNumber', 'sortCode'];

export interface BankDetails {
  iban?: string | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
  sortCode?: string | null;
}

export interface DetailRow {
  label: string;
  value: string;
}

const FIELDS_BY_FORMAT: Record<BankAccountFormat, BankField[]> = {
  iban: ['iban'],
  accountNumberRoutingNumber: ['accountNumber', 'routingNumber'],
  accountNumberSortCode: ['accountNumber', 'sortCode']
};

const INVALID_DETAILS_MESSAGES: Record<BankAccountFormat, string> = {
  iban: "This IBAN isn't valid. Check it and try again.",
  accountNumberRoutingNumber: "These bank details aren't valid. Check the account number and the ABA routing number.",
  accountNumberSortCode: "These bank details aren't valid. Check the account number and the sort code."
};

export function compactIban(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, '').toUpperCase();
}

export function digitsOnly(value: string | null | undefined): string {
  return (value || '').replace(/[\s-]+/g, '');
}

export function formatIban(value: string | null | undefined): string {
  return compactIban(value).replace(/(.{4})(?=.)/g, '$1 ');
}

export function formatSortCode(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  return /^\d{6}$/.test(digits) ? digits.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3') : (value || '');
}

function patternValidator(clean: (value: string) => string, pattern: RegExp, errorKey: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = clean(control.value || '');
    return !value || pattern.test(value) ? null : { [errorKey]: true };
  };
}

function validatorsFor(format: BankAccountFormat, field: BankField): ValidatorFn[] {
  switch (field) {
    case 'iban':
      return [Validators.required, patternValidator(compactIban, /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'ibanFormat')];
    case 'routingNumber':
      return [Validators.required, patternValidator(digitsOnly, /^\d{9}$/, 'routingNumberFormat')];
    case 'sortCode':
      return [Validators.required, patternValidator(digitsOnly, /^\d{6}$/, 'sortCodeFormat')];
    case 'accountNumber':
      return format === 'accountNumberSortCode'
        ? [Validators.required, patternValidator(digitsOnly, /^\d{8}$/, 'accountNumberFormat')]
        : [Validators.required, patternValidator(digitsOnly, /^\d{4,17}$/, 'accountNumberFormat')];
  }
}

/** Bank details as sent to the backend: only the fields of the format, without spaces or dashes. */
export function normalizeBankDetails(format: BankAccountFormat | null, details: BankDetails): Record<BankField, string> {
  return {
    iban: format === 'iban' ? compactIban(details.iban) : '',
    accountNumber: format && format !== 'iban' ? digitsOnly(details.accountNumber) : '',
    routingNumber: format === 'accountNumberRoutingNumber' ? digitsOnly(details.routingNumber) : '',
    sortCode: format === 'accountNumberSortCode' ? digitsOnly(details.sortCode) : ''
  };
}

/** Recap rows for the identifiers of a beneficiary account, whatever its type. */
export function bankDetailRows(details: BankDetails): DetailRow[] {
  const rows: DetailRow[] = [];
  if (details.iban) rows.push({ label: 'IBAN', value: formatIban(details.iban) });
  if (details.accountNumber) rows.push({ label: 'Account number', value: digitsOnly(details.accountNumber) });
  if (details.sortCode) rows.push({ label: 'Sort code', value: formatSortCode(details.sortCode) });
  if (details.routingNumber) rows.push({ label: 'ABA routing number', value: digitsOnly(details.routingNumber) });
  return rows;
}

/** One-line summary of the beneficiary account, e.g. "Account 50000000 · Sort code 20-26-78". */
export function bankDetailsSummary(details: BankDetails): string {
  if (details.iban) return formatIban(details.iban);
  const parts: string[] = [];
  if (details.accountNumber) parts.push(`Account ${digitsOnly(details.accountNumber)}`);
  if (details.sortCode) parts.push(`Sort code ${formatSortCode(details.sortCode)}`);
  if (details.routingNumber) parts.push(`Routing ${digitsOnly(details.routingNumber)}`);
  return parts.join(' · ') || '—';
}

export function bankFieldError(control: AbstractControl | null): string {
  if (!control || !control.errors || !(control.touched || control.dirty)) return '';
  const errors = control.errors;
  if (errors['required']) return 'This field is required.';
  if (errors['ibanFormat']) return 'Enter an IBAN: 2 letters, 2 digits, then up to 30 letters or digits.';
  if (errors['routingNumberFormat']) return 'Enter the 9-digit ABA routing number.';
  if (errors['sortCodeFormat']) return 'Enter the 6-digit sort code.';
  if (errors['accountNumberFormat']) return 'Enter a valid account number (digits only).';
  return '';
}

/** Why the transfer speed control blocks the submit button, if it does. */
export function speedBlockReason(control: AbstractControl | null): string {
  const errors = control?.errors;
  if (!errors) return '';
  if (errors['transferRoutesNotLoaded']) return 'Waiting for the available transfer speeds.';
  if (errors['transferAmount']) return 'Change the amount to fit the limits of the selected transfer speed.';
  return 'Choose a transfer speed to continue.';
}

/**
 * Format-specific validators and server-side check of the beneficiary bank details of one form.
 * Each form owns its own instance, so switching between forms keeps what was typed.
 */
export class BankDetailsCheck {
  format: BankAccountFormat | null = null;
  checking = false;
  valid = false;
  error = '';
  // Bank details the transfer routes are calculated for, set once they pass the check.
  routeBeneficiary: TransferRouteRequest | null = null;

  private sub?: Subscription;

  constructor(
    private readonly form: FormGroup,
    private readonly transferService: TransferService,
    private readonly changed: () => void
  ) {}

  get ready(): boolean {
    return !!this.format && this.valid && !this.checking;
  }

  /** Why these bank details block the submit button, if they do. */
  get blockReason(): string {
    if (!this.format) return 'Choose the recipient country to continue.';
    if (this.checking) return 'Checking the bank details...';
    if (!this.valid) return this.error ? 'Correct the bank details to continue.' : 'Enter the bank details to continue.';
    return '';
  }

  get fields(): BankField[] {
    return this.format ? FIELDS_BY_FORMAT[this.format] : [];
  }

  /** Clears the bank fields and applies the validators of the new format. */
  setFormat(format: BankAccountFormat | null) {
    this.sub?.unsubscribe();
    this.format = format;
    this.valid = false;
    this.error = '';
    this.checking = false;
    this.routeBeneficiary = null;

    BANK_FIELDS.forEach(field => {
      const control = this.form.get(field);
      control?.setValidators(format && this.fields.includes(field) ? validatorsFor(format, field) : null);
      control?.reset('');
    });

    if (format) this.watch(format);
  }

  /** Empties the bank fields but keeps the current format (another transfer to the same country). */
  restart() {
    this.setFormat(this.format);
  }

  destroy() {
    this.sub?.unsubscribe();
  }

  normalized(): Record<BankField, string> {
    return normalizeBankDetails(this.format, this.form.getRawValue());
  }

  private watch(format: BankAccountFormat) {
    const controls = this.fields.map(field => this.form.get(field)!);
    const allValid = () => controls.every(control => control.value && control.valid);

    this.sub = combineLatest(controls.map(control => control.valueChanges.pipe(startWith(control.value)))).pipe(
      tap(() => {
        // Edits invalidate the previous result right away, so a stale "valid" never enables the submit button.
        this.valid = false;
        this.routeBeneficiary = null;
        this.error = '';
        this.checking = allValid();
        this.changed();
      }),
      debounceTime(800),
      filter(() => allValid()),
      switchMap(() => this.check(format))
    ).subscribe(result => {
      this.checking = false;
      this.valid = result.valid;
      this.error = result.error;
      if (result.valid) {
        const details = this.normalized();
        this.routeBeneficiary = { counterpartyCountry: this.form.get('counterpartyCountry')?.value || '', ...details };
      }
      this.changed();
    });
  }

  private check(format: BankAccountFormat): Observable<{ valid: boolean; error: string }> {
    const request = {
      bankAccountFormat: format,
      counterpartyCountry: this.form.get('counterpartyCountry')?.value || '',
      transferType: '',
      ...this.normalized()
    } as IsBankAccountValidRequest;

    return this.transferService.isBankAccountValid(request).pipe(
      map(res => {
        const valid = String(res.isBankAccountValid) === 'true';
        return { valid, error: valid ? '' : INVALID_DETAILS_MESSAGES[format] };
      }),
      catchError(err => of({ valid: false, error: httpErrorMessage(err, INVALID_DETAILS_MESSAGES[format]) }))
    );
  }
}
