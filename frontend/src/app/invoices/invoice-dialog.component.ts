import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Customer, Invoice, InvoiceLine, InvoiceRequest, InvoiceSettings } from '../models';
import { InvoiceService } from '../services';
import { InlineAlertComponent, MoneyPipe, currencyExponent, fromMinorUnits, httpErrorMessage, toMinorUnits } from '../shared';
import { CustomerDialogComponent, CustomerDialogData } from './customer-dialog.component';
import { LineAmounts, Totals, addDays, formatRate, isoDate, lineAmounts, plural, totalsOf } from './invoice-view';

export interface InvoiceDialogData {
  userId: string;
  settings: InvoiceSettings;
  customers: Customer[];
  /** Edits this draft; creates an invoice otherwise. */
  invoice?: Invoice;
  /** The customer of a new invoice. */
  customerId?: number;
}

export interface InvoiceDialogResult {
  invoice: Invoice;
  sent: boolean;
}

const MAX_LINES = 50;
const MAX_QUANTITY = 1_000_000;
const MAX_UNIT_PRICE = 1_000_000_000;

/** Creates or edits a draft invoice, and can send it right away. Closes with the saved invoice. */
@Component({
  selector: 'app-invoice-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MoneyPipe,
    InlineAlertComponent,
  ],
  templateUrl: './invoice-dialog.component.html',
  styleUrls: ['../checkout/advanced-options/form-fields.css', './dialog.css', './invoice-dialog.component.css'],
})
export class InvoiceDialogComponent {
  private readonly data: InvoiceDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<InvoiceDialogComponent, InvoiceDialogResult>>(MatDialogRef);
  private readonly invoiceService = inject(InvoiceService);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);

  readonly settings = this.data.settings;
  readonly currency = this.data.invoice?.currency ?? this.settings.currency;
  readonly taxLabel = this.settings.taxLabel;
  readonly maxLines = MAX_LINES;
  readonly priceStep = 1 / Math.pow(10, currencyExponent(this.currency));
  readonly rates: number[];
  readonly formatRate = formatRate;
  readonly title = this.data.invoice ? `Edit ${this.data.invoice.number}` : 'New invoice';

  readonly customers = signal<Customer[]>([...this.data.customers]);
  readonly customerId = signal<number | null>(null);
  readonly selectedCustomer = computed(() => this.customers().find(c => c.id === this.customerId()) ?? null);
  readonly lineTotals = signal<(LineAmounts | null)[]>([]);
  readonly totals = signal<Totals>({ net: 0, tax: 0, gross: 0, vat: [] });
  readonly submitting = signal<'draft' | 'send' | null>(null);
  readonly error = signal<string | null>(null);
  readonly errorTitle = signal('Unable to save the invoice');

  readonly form: FormGroup;
  /** The saved draft: saving again updates it rather than creating another invoice. */
  private saved: Invoice | null = this.data.invoice ?? null;
  private dueDateEdited = !!this.data.invoice;

  constructor() {
    const invoice = this.data.invoice;
    const issueDate = invoice?.issueDate ?? isoDate(new Date());
    const lines: (InvoiceLine | undefined)[] = invoice?.lines.length ? invoice.lines : [undefined];
    this.rates = [...new Set([
      ...this.settings.vatRates.map(Number),
      ...(invoice?.lines ?? []).map(line => Number(line.vatRate)),
    ])].sort((a, b) => b - a);

    this.form = this.fb.group({
      customerId: [invoice?.customer.id ?? this.data.customerId ?? (this.customers().length === 1 ? this.customers()[0].id : null),
        Validators.required],
      issueDate: [issueDate, Validators.required],
      dueDate: [invoice?.dueDate ?? addDays(issueDate, this.settings.paymentTermsDays), Validators.required],
      notes: [invoice?.notes ?? '', Validators.maxLength(1000)],
      lines: this.fb.array(lines.map(line => this.lineGroup(line))),
    }, { validators: (group: AbstractControl) => this.validateDates(group) });

    this.customerId.set(this.form.get('customerId')?.value ?? null);
    this.form.get('customerId')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(id => this.customerId.set(id));
    this.form.get('issueDate')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(date => {
      if (!this.dueDateEdited && date) {
        this.form.get('dueDate')?.setValue(addDays(date, this.settings.paymentTermsDays), { emitEvent: false });
      }
    });
    this.form.get('dueDate')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.dueDateEdited = true);
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.error.set(null);
      this.computeTotals();
    });
    this.computeTotals();
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  asGroup(control: AbstractControl): FormGroup {
    return control as FormGroup;
  }

  get termsText(): string {
    const { issueDate, dueDate } = this.form.value;
    const issue = issueDate ? new Date(issueDate) : null;
    const due = dueDate ? new Date(dueDate) : null;
    if (!issue || !due || isNaN(issue.getTime()) || isNaN(due.getTime())) return '';
    const days = Math.round((due.getTime() - issue.getTime()) / 86_400_000);
    if (days < 0) return '';
    return days === 0 ? 'Due on receipt.' : `${plural(days, 'day')} after the issue date.`;
  }

  get customerError(): string | null {
    const control = this.form.get('customerId');
    return control?.invalid && control.touched ? 'Choose a customer, or add a new one.' : null;
  }

  get datesError(): string | null {
    const control = this.form.get('dueDate');
    if (control?.invalid && control.touched) return 'Enter a due date.';
    return this.form.errors?.['dates'] && (control?.touched || control?.dirty) ? this.form.errors['dates'] : null;
  }

  lineError(index: number): string | null {
    const group = this.lines.at(index);
    for (const name of ['description', 'quantity', 'unitPrice']) {
      const control = group.get(name);
      if (control?.invalid && (control.touched || control.dirty)) {
        if (name === 'description') {
          return control.errors?.['required'] ? 'Enter a description.' : 'Use up to 200 characters.';
        }
        return control.errors?.[name] ?? null;
      }
    }
    return null;
  }

  lineInvalid(index: number, name: string): boolean {
    const control = this.lines.at(index).get(name);
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  addLine(): void {
    if (this.lines.length >= MAX_LINES) return;
    this.lines.push(this.lineGroup());
    setTimeout(() => document.getElementById(`invoice-line-${this.lines.length - 1}-description`)?.focus());
  }

  removeLine(index: number): void {
    if (this.lines.length === 1) return;
    this.lines.removeAt(index);
    const next = Math.min(index, this.lines.length - 1);
    setTimeout(() => document.getElementById(`invoice-line-${next}-description`)?.focus());
  }

  addCustomer(): void {
    const ref = this.dialog.open<CustomerDialogComponent, CustomerDialogData, Customer>(CustomerDialogComponent, {
      data: { userId: this.data.userId, defaultCountry: this.settings.country },
      width: '560px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: '#customer-company',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(customer => {
      if (!customer) return;
      this.customers.update(list => [...list, customer]
        .sort((a, b) => a.displayName.localeCompare(b.displayName)));
      const control = this.form.get('customerId');
      control?.setValue(customer.id);
      control?.markAsTouched();
    });
  }

  submit(send: boolean): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => document.querySelector<HTMLElement>('#invoice-form [aria-invalid="true"]')?.focus());
      return;
    }
    if (this.totals().gross <= 0) {
      this.errorTitle.set('Unable to save the invoice');
      this.error.set('The total of the invoice must be greater than 0.');
      return;
    }
    const userId = this.data.userId;
    const request = this.request();
    this.error.set(null);
    this.submitting.set(send ? 'send' : 'draft');
    this.dialogRef.disableClose = true;
    const save$ = this.saved
      ? this.invoiceService.update(userId, this.saved.id, request)
      : this.invoiceService.create(userId, request);
    save$.subscribe({
      next: draft => {
        this.saved = draft;
        if (!send) {
          this.dialogRef.close({ invoice: draft, sent: false });
          return;
        }
        this.invoiceService.send(userId, draft.id).subscribe({
          next: sent => this.dialogRef.close({ invoice: sent, sent: true }),
          error: err => this.fail(`${draft.number} is saved as a draft, but couldn't be sent`,
            httpErrorMessage(err, 'The payment link couldn\'t be created. Try again.'))
        });
      },
      error: err => this.fail('Unable to save the invoice', httpErrorMessage(err, 'Unable to save the invoice. Try again.'))
    });
  }

  /** Closes with the draft saved before a failed send, so that the list shows it. */
  close(): void {
    this.dialogRef.close(this.saved && this.saved !== this.data.invoice ? { invoice: this.saved, sent: false } : undefined);
  }

  private fail(title: string, message: string): void {
    this.errorTitle.set(title);
    this.error.set(message);
    this.submitting.set(null);
    this.dialogRef.disableClose = false;
  }

  private request(): InvoiceRequest {
    const value = this.form.value;
    return {
      customerId: value.customerId,
      issueDate: value.issueDate || null,
      dueDate: value.dueDate || null,
      notes: (value.notes || '').trim() || null,
      lines: this.lines.controls.map(group => ({
        description: String(group.value.description).trim(),
        quantity: Number(group.value.quantity),
        unitPrice: toMinorUnits(Number(group.value.unitPrice), this.currency),
        vatRate: Number(group.value.vatRate),
      })),
    };
  }

  private lineGroup(line?: InvoiceLine): FormGroup {
    return this.fb.group({
      description: [line?.description ?? '', [Validators.required, Validators.maxLength(200)]],
      quantity: [line?.quantity ?? 1, (control: AbstractControl) => this.validateQuantity(control)],
      unitPrice: [line ? fromMinorUnits(line.unitPrice, this.currency) : null,
        (control: AbstractControl) => this.validatePrice(control)],
      vatRate: [line ? Number(line.vatRate) : Number(this.settings.defaultVatRate)],
    });
  }

  private computeTotals(): void {
    const lines = this.lines.controls.map(group => {
      if (group.get('quantity')?.invalid || group.get('unitPrice')?.invalid) return null;
      const rate = Number(group.value.vatRate);
      return {
        rate,
        amounts: lineAmounts(Number(group.value.quantity), toMinorUnits(Number(group.value.unitPrice), this.currency), rate),
      };
    });
    this.lineTotals.set(lines.map(line => line?.amounts ?? null));
    this.totals.set(totalsOf(lines.filter((line): line is NonNullable<typeof line> => line !== null)));
  }

  private validateQuantity(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    const value = Number(raw);
    if (raw === null || raw === '' || !Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
      return { quantity: 'Enter a whole number from 1 to 1,000,000.' };
    }
    return null;
  }

  private validatePrice(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    const value = Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(value) || value < 0) {
      return { unitPrice: 'Enter a unit price of 0 or more.' };
    }
    const digits = currencyExponent(this.currency);
    const decimals = String(raw).split('.')[1]?.length ?? 0;
    if (decimals > digits) {
      return { unitPrice: digits === 0 ? 'Enter a whole amount.' : `Use up to ${digits} decimals.` };
    }
    if (value > MAX_UNIT_PRICE) {
      return { unitPrice: 'Enter a smaller unit price.' };
    }
    return null;
  }

  private validateDates(group: AbstractControl): ValidationErrors | null {
    const issue = group.get('issueDate')?.value;
    const due = group.get('dueDate')?.value;
    return issue && due && due < issue ? { dates: "The due date can't be before the issue date." } : null;
  }
}
