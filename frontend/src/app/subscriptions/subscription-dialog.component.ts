import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Customer, CustomerSubscription, SubscriptionFrequency, SubscriptionRequest, SubscriptionSettings } from '../models';
import { SubscriptionService } from '../services';
import { InlineAlertComponent, MoneyPipe, currencyExponent, httpErrorMessage, toMinorUnits } from '../shared';
import { CustomerDialogComponent, CustomerDialogData } from '../invoices/customer-dialog.component';
import { LineAmounts, addDays, formatRate, isoDate, lineAmounts } from '../invoices/invoice-view';
import { periodNoun } from './subscription-view';

export interface SubscriptionDialogData {
  userId: string;
  settings: SubscriptionSettings;
  customers: Customer[];
  /** The customer of the new subscription. */
  customerId?: number;
}

const MAX_PRICE = 1_000_000_000;
/** The backend accepts a start date up to a year from today. */
const MAX_START_DAYS = 365;
const PLAN_SUGGESTIONS = ['Website care plan', 'Cloud hosting', 'Support and maintenance', 'Software licence'];

/** Creates a subscription and sends its first invoice. Closes with the created subscription. */
@Component({
  selector: 'app-subscription-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MoneyPipe,
    InlineAlertComponent,
  ],
  templateUrl: './subscription-dialog.component.html',
  styleUrls: ['../checkout/advanced-options/form-fields.css', '../invoices/dialog.css', './subscription-dialog.component.css'],
})
export class SubscriptionDialogComponent {
  private readonly data: SubscriptionDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<SubscriptionDialogComponent, CustomerSubscription>>(MatDialogRef);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);

  readonly settings = this.data.settings;
  readonly currency = this.settings.currency;
  readonly taxLabel = this.settings.taxLabel;
  readonly priceStep = 1 / Math.pow(10, currencyExponent(this.currency));
  readonly rates = [...new Set(this.settings.vatRates.map(Number))].sort((a, b) => b - a);
  readonly planSuggestions = PLAN_SUGGESTIONS;
  readonly formatRate = formatRate;
  readonly today = isoDate(new Date());
  readonly minStart = addDays(this.today, -MAX_START_DAYS);
  readonly maxStart = addDays(this.today, MAX_START_DAYS);

  readonly customers = signal<Customer[]>([...this.data.customers]);
  readonly customerId = signal<number | null>(null);
  readonly selectedCustomer = computed(() => this.customers().find(c => c.id === this.customerId()) ?? null);
  readonly frequency = signal<SubscriptionFrequency>('MONTHLY');
  readonly period = computed(() => periodNoun(this.frequency()));
  /** Null while the price is invalid. */
  readonly amounts = signal<LineAmounts | null>(null);
  readonly autoRescue = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form: FormGroup;

  constructor() {
    const customers = this.customers();
    this.form = this.fb.group({
      customerId: [this.data.customerId ?? (customers.length === 1 ? customers[0].id : null), Validators.required],
      plan: ['', [Validators.required, Validators.maxLength(120)]],
      frequency: ['MONTHLY'],
      price: [null, (control: AbstractControl) => this.validatePrice(control)],
      vatRate: [Number(this.settings.defaultVatRate)],
      startDate: [this.today, Validators.required],
      autoRescue: [false],
      rescueDays: [this.settings.defaultRescueDays],
    }, { validators: (group: AbstractControl) => this.validateRescueDays(group) });

    this.customerId.set(this.form.get('customerId')?.value ?? null);
    this.form.get('customerId')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(id => this.customerId.set(id));
    this.form.get('frequency')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.frequency.set(value));
    this.form.get('autoRescue')?.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.autoRescue.set(!!value));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.error.set(null);
      this.computeAmounts();
    });
  }

  get customerError(): string | null {
    const control = this.form.get('customerId');
    return control?.invalid && control.touched ? 'Choose a customer, or add a new one.' : null;
  }

  get planError(): string | null {
    const control = this.form.get('plan');
    if (!control?.invalid || !(control.touched || control.dirty)) return null;
    return control.errors?.['required'] ? 'Enter the name of the plan.' : 'Use up to 120 characters.';
  }

  get priceError(): string | null {
    const control = this.form.get('price');
    return control?.invalid && (control.touched || control.dirty) ? control.errors?.['price'] ?? null : null;
  }

  get rescueError(): string | null {
    const control = this.form.get('rescueDays');
    return this.form.errors?.['rescueDays'] && (control?.touched || control?.dirty) ? this.form.errors['rescueDays'] : null;
  }

  get startHelp(): string {
    const start = this.form.value.startDate;
    if (!start) return 'The first day of the first cycle.';
    return this.frequency() === 'YEARLY'
      ? 'The first day of the first cycle. The next cycles start on the same day every year.'
      : 'The first day of the first cycle. The next cycles start on the same day every month.';
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
      this.customers.update(list => [...list, customer].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      const control = this.form.get('customerId');
      control?.setValue(customer.id);
      control?.markAsTouched();
    });
  }

  submit(): void {
    if (this.submitting() || this.settings.issue) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => document.querySelector<HTMLElement>('#subscription-form [aria-invalid="true"]')?.focus());
      return;
    }
    const value = this.form.value;
    const autoRescue = this.settings.autoRescueAvailable && !!value.autoRescue;
    const request: SubscriptionRequest = {
      customerId: value.customerId,
      plan: String(value.plan).trim(),
      price: toMinorUnits(Number(value.price), this.currency),
      vatRate: Number(value.vatRate),
      frequency: value.frequency,
      startDate: value.startDate || null,
      autoRescue,
      rescueDays: autoRescue ? Number(value.rescueDays) : null,
    };
    this.error.set(null);
    this.submitting.set(true);
    this.dialogRef.disableClose = true;
    this.subscriptionService.create(this.data.userId, request).subscribe({
      next: subscription => this.dialogRef.close(subscription),
      error: err => {
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
        this.error.set(httpErrorMessage(err, 'Unable to create the subscription. Try again.'));
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  private computeAmounts(): void {
    const price = this.form.get('price');
    this.amounts.set(price && price.valid
      ? lineAmounts(1, toMinorUnits(Number(price.value), this.currency), Number(this.form.value.vatRate))
      : null);
  }

  private validatePrice(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    const value = Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(value) || value <= 0) {
      return { price: 'Enter a price greater than 0.' };
    }
    const digits = currencyExponent(this.currency);
    const decimals = String(raw).split('.')[1]?.length ?? 0;
    if (decimals > digits) {
      return { price: digits === 0 ? 'Enter a whole amount.' : `Use up to ${digits} decimals.` };
    }
    if (value > MAX_PRICE) {
      return { price: 'Enter a smaller price.' };
    }
    return null;
  }

  private validateRescueDays(group: AbstractControl): ValidationErrors | null {
    if (!this.settings.autoRescueAvailable || !group.get('autoRescue')?.value) return null;
    const raw = group.get('rescueDays')?.value;
    const days = Number(raw);
    const max = this.settings.maxRescueDays;
    return raw === null || raw === '' || !Number.isInteger(days) || days < 1 || days > max
      ? { rescueDays: `Enter a whole number of days from 1 to ${max}.` }
      : null;
  }
}
