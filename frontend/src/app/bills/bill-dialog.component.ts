import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Bill, BillRequest, BillSettings, LedgerAccount, Supplier } from '../models';
import { BillService } from '../services';
import { InlineAlertComponent, MoneyPipe, currencyExponent, fromMinorUnits, httpErrorMessage, toMinorUnits } from '../shared';
import { LineAmounts, addDays, formatRate, isoDate, lineAmounts, plural } from '../invoices/invoice-view';
import { SupplierDialogComponent, SupplierDialogData } from './supplier-dialog.component';

export interface BillDialogData {
  userId: string;
  settings: BillSettings;
  suppliers: Supplier[];
  /** Edits this bill; records a new one otherwise. */
  bill?: Bill;
  /** The supplier of a new bill. */
  supplierId?: number;
}

/** Same limit as the backend, in minor units. */
const MAX_AMOUNT = 100_000_000_000;
/** The backend books a bill without category, of a supplier without default, to this account. */
const OTHER_EXPENSES = '6290';

/** Records or edits a supplier bill. Closes with the saved bill. */
@Component({
  selector: 'app-bill-dialog',
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
  templateUrl: './bill-dialog.component.html',
  styleUrls: [
    '../checkout/advanced-options/form-fields.css',
    '../invoices/dialog.css',
    '../invoices/invoice-dialog.component.css',
    './bill-dialogs.css',
  ],
})
export class BillDialogComponent {
  private readonly data: BillDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<BillDialogComponent, Bill>>(MatDialogRef);
  private readonly billService = inject(BillService);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);

  readonly settings = this.data.settings;
  readonly editing = !!this.data.bill;
  readonly currency = this.data.bill?.currency ?? this.settings.currency;
  readonly taxLabel = this.settings.taxLabel;
  readonly amountStep = 1 / Math.pow(10, currencyExponent(this.currency));
  readonly formatRate = formatRate;
  readonly title = this.data.bill ? `Edit ${this.data.bill.number}` : 'New bill';
  readonly rates: number[];
  readonly categories: LedgerAccount[];

  readonly suppliers = signal<Supplier[]>([...this.data.suppliers]);
  readonly supplierId = signal<number | null>(null);
  readonly selectedSupplier = computed(() => this.suppliers().find(s => s.id === this.supplierId()) ?? null);
  readonly amounts = signal<LineAmounts | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form: FormGroup;
  private dueDateEdited = !!this.data.bill;
  private categoryEdited = !!this.data.bill;

  constructor() {
    const bill = this.data.bill;
    const issueDate = bill?.issueDate ?? isoDate(new Date());
    this.rates = [...new Set([
      ...this.settings.vatRates.map(Number),
      ...(bill ? [Number(bill.vatRate)] : []),
    ])].sort((a, b) => b - a);
    this.categories = bill && !this.settings.categories.some(c => c.code === bill.category)
      ? [...this.settings.categories, { code: bill.category, name: bill.categoryName }]
      : this.settings.categories;
    const supplierId = bill?.supplier.id ?? this.data.supplierId
      ?? (this.suppliers().length === 1 ? this.suppliers()[0].id : null);

    this.form = this.fb.group({
      supplierId: [supplierId, Validators.required],
      supplierReference: [bill?.supplierReference ?? '', Validators.maxLength(40)],
      issueDate: [issueDate, Validators.required],
      dueDate: [bill?.dueDate ?? addDays(issueDate, this.settings.paymentTermsDays), Validators.required],
      description: [bill?.description ?? '', Validators.maxLength(200)],
      subtotal: [bill ? fromMinorUnits(bill.subtotal, this.currency) : null,
        (control: AbstractControl) => this.validateAmount(control)],
      vatRate: [bill ? Number(bill.vatRate) : Number(this.settings.defaultVatRate)],
      category: [bill?.category ?? this.defaultCategory(supplierId), Validators.required],
    }, { validators: (group: AbstractControl) => this.validateDates(group) });

    this.supplierId.set(supplierId);
    this.form.get('supplierId')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(id => {
      this.supplierId.set(id);
      if (!this.categoryEdited) {
        this.form.get('category')?.setValue(this.defaultCategory(id), { emitEvent: false });
      }
    });
    this.form.get('category')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.categoryEdited = true);
    this.form.get('issueDate')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(date => {
      if (!this.dueDateEdited && date) {
        this.form.get('dueDate')?.setValue(addDays(date, this.settings.paymentTermsDays), { emitEvent: false });
      }
    });
    this.form.get('dueDate')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.dueDateEdited = true);
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.error.set(null);
      this.computeAmounts();
    });
    this.computeAmounts();
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

  get supplierError(): string | null {
    const control = this.form.get('supplierId');
    return control?.invalid && control.touched ? 'Choose a supplier, or add a new one.' : null;
  }

  get datesError(): string | null {
    const control = this.form.get('dueDate');
    if (control?.invalid && control.touched) return 'Enter a due date.';
    return this.form.errors?.['dates'] && (control?.touched || control?.dirty) ? this.form.errors['dates'] : null;
  }

  get amountError(): string | null {
    const control = this.form.get('subtotal');
    return control?.invalid && (control.touched || control.dirty) ? control.errors?.['amount'] ?? null : null;
  }

  supplierHint(supplier: Supplier): string {
    return supplier.bankAccount
      ? `Bank account ${supplier.bankAccount}`
      : 'No bank details: this bill is paid with a single-use card.';
  }

  addSupplier(): void {
    const ref = this.dialog.open<SupplierDialogComponent, SupplierDialogData, Supplier>(SupplierDialogComponent, {
      data: { userId: this.data.userId, settings: this.settings },
      width: '600px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: '#supplier-name',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(supplier => {
      if (!supplier) return;
      this.suppliers.update(list => [...list, supplier].sort((a, b) => a.name.localeCompare(b.name)));
      const control = this.form.get('supplierId');
      control?.setValue(supplier.id);
      control?.markAsTouched();
    });
  }

  submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => document.querySelector<HTMLElement>('#bill-form [aria-invalid="true"]')?.focus());
      return;
    }
    const bill = this.data.bill;
    const request = this.request();
    this.error.set(null);
    this.submitting.set(true);
    this.dialogRef.disableClose = true;
    const save$ = bill
      ? this.billService.update(this.data.userId, bill.id, request)
      : this.billService.create(this.data.userId, request);
    save$.subscribe({
      next: saved => this.dialogRef.close(saved),
      error: err => {
        this.error.set(httpErrorMessage(err, 'Unable to save the bill. Try again.'));
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
      }
    });
  }

  private request(): BillRequest {
    const value = this.form.value;
    return {
      supplierId: value.supplierId,
      supplierReference: String(value.supplierReference ?? '').trim() || null,
      issueDate: value.issueDate || null,
      dueDate: value.dueDate || null,
      description: String(value.description ?? '').trim() || null,
      subtotal: toMinorUnits(Number(value.subtotal), this.currency),
      vatRate: Number(value.vatRate),
      category: value.category || null,
    };
  }

  private defaultCategory(supplierId: number | null): string {
    const supplier = this.suppliers().find(s => s.id === supplierId);
    const code = supplier?.defaultCategory || OTHER_EXPENSES;
    return this.categories.some(c => c.code === code) ? code : (this.categories[0]?.code ?? '');
  }

  private computeAmounts(): void {
    const control = this.form.get('subtotal');
    if (!control || control.invalid) {
      this.amounts.set(null);
      return;
    }
    this.amounts.set(lineAmounts(1, toMinorUnits(Number(control.value), this.currency), Number(this.form.get('vatRate')?.value)));
  }

  private validateAmount(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    const value = Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(value) || value <= 0) {
      return { amount: `Enter the amount excluding ${this.taxLabel}, greater than 0.` };
    }
    const digits = currencyExponent(this.currency);
    const decimals = String(raw).split('.')[1]?.length ?? 0;
    if (decimals > digits) {
      return { amount: digits === 0 ? 'Enter a whole amount.' : `Use up to ${digits} decimals.` };
    }
    if (toMinorUnits(value, this.currency) > MAX_AMOUNT) {
      return { amount: 'Enter a smaller amount.' };
    }
    return null;
  }

  private validateDates(group: AbstractControl): ValidationErrors | null {
    const issue = group.get('issueDate')?.value;
    const due = group.get('dueDate')?.value;
    return issue && due && due < issue ? { dates: "The due date can't be before the issue date." } : null;
  }
}
