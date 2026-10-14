import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges, forwardRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validator } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { MaterialModule } from '../material.module';
import { TransferPriority, TransferRouteOption, TransferRouteRequest } from '../models';
import { TransferService } from '../services';

interface SpeedOption {
  priority: TransferPriority;
  label: string;
  timing: string;
  route: TransferRouteOption | null;
}

const SPEEDS: Omit<SpeedOption, 'route'>[] = [
  { priority: 'regular', label: 'Regular', timing: '1-2 business days' },
  { priority: 'fast', label: 'Fast', timing: 'Same business day' },
  { priority: 'instant', label: 'Instant', timing: 'Within seconds' }
];

let nextPickerId = 0;

@Component({
  selector: 'app-transfer-speed-picker',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: './transfer-speed-picker.component.html',
  styleUrl: './transfer-speed-picker.component.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TransferSpeedPickerComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => TransferSpeedPickerComponent), multi: true }
  ]
})
export class TransferSpeedPickerComponent implements ControlValueAccessor, Validator, OnChanges, OnDestroy {

  @Input() userId = '';
  // Null until the bank details have passed the format check.
  @Input() beneficiary: TransferRouteRequest | null = null;
  // In major units, as typed in the form.
  @Input() amount: number | null = null;
  @Input() currency = '';

  readonly radioName = `transfer-speed-${nextPickerId++}`;
  status: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  options: SpeedOption[] = [];
  errorMessage = '';
  value: TransferPriority | null = null;
  disabled = false;

  private transferService = inject(TransferService);
  private cdr = inject(ChangeDetectorRef);
  private routesSub?: Subscription;
  private onChange: (value: TransferPriority | null) => void = () => {};
  private onValidatorChange: () => void = () => {};
  onTouched: () => void = () => {};

  ngOnChanges(changes: SimpleChanges) {
    if (changes['beneficiary'] || changes['userId']) {
      this.loadRoutes();
    } else if (changes['amount']) {
      this.onValidatorChange();
    }
  }

  ngOnDestroy() {
    this.routesSub?.unsubscribe();
  }

  get hasAvailableRoute(): boolean {
    return this.options.some(option => option.route);
  }

  get selectedRoute(): TransferRouteOption | null {
    return this.options.find(option => option.priority === this.value)?.route ?? null;
  }

  get selectedLabel(): string {
    return SPEEDS.find(speed => speed.priority === this.value)?.label ?? '';
  }

  get amountError(): string {
    const route = this.selectedRoute;
    const amount = this.amountInMinorUnits;
    if (!route || amount === null) return '';

    const speed = this.selectedLabel.toLowerCase();
    if (route.minAmount !== null && amount < route.minAmount) {
      return `The minimum amount for ${speed} transfers to this beneficiary is ${this.formatAmount(route.minAmount)}.`;
    }
    if (route.maxAmount !== null && amount > route.maxAmount) {
      return `The maximum amount for ${speed} transfers to this beneficiary is ${this.formatAmount(route.maxAmount)}.`;
    }
    // Every recipient currency (EUR, GBP, USD) has two decimals.
    if (route.wholeAmountsOnly && amount % 100 !== 0) {
      return `${this.selectedLabel} transfers to this beneficiary only accept whole amounts.`;
    }
    return '';
  }

  limitsOf(route: TransferRouteOption): string {
    const limits: string[] = [];
    // A one-cent minimum adds nothing: every transfer is at least that.
    if (route.minAmount !== null && route.minAmount > 1) limits.push(`Min ${this.formatAmount(route.minAmount)}`);
    if (route.maxAmount !== null) limits.push(`Max ${this.formatAmount(route.maxAmount)}`);
    if (route.wholeAmountsOnly) limits.push('Whole amounts only');
    return limits.join(' · ');
  }

  select(priority: TransferPriority) {
    this.value = priority;
    this.onChange(priority);
    this.onTouched();
  }

  retry() {
    this.loadRoutes();
  }

  writeValue(value: TransferPriority | null) {
    this.value = value || null;
  }

  registerOnChange(fn: (value: TransferPriority | null) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    this.disabled = disabled;
  }

  validate(): ValidationErrors | null {
    if (this.status !== 'loaded') return { transferRoutesNotLoaded: true };
    if (!this.selectedRoute) return { transferSpeedUnavailable: true };
    const amountError = this.amountError;
    return amountError ? { transferAmount: amountError } : null;
  }

  registerOnValidatorChange(fn: () => void) {
    this.onValidatorChange = fn;
  }

  private loadRoutes() {
    this.routesSub?.unsubscribe();
    this.options = [];
    this.errorMessage = '';
    this.status = this.beneficiary && this.userId ? 'loading' : 'idle';
    this.onValidatorChange();
    if (!this.beneficiary || !this.userId) return;

    this.routesSub = this.transferService.calculateTransferRoutes(this.userId, this.beneficiary).subscribe({
      next: routes => {
        this.options = SPEEDS.map(speed => ({ ...speed, route: routes.find(route => route.priority === speed.priority) ?? null }));
        this.status = 'loaded';
        // Only an empty value gets a default: a speed the user picked, or the one saved on a
        // scheduled transfer, stays as is and is reported if this beneficiary cannot receive it.
        const cheapest = this.options.find(option => option.route);
        if (!this.value && cheapest) {
          this.value = cheapest.priority;
          this.onChange(cheapest.priority);
        }
        this.onValidatorChange();
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.status = 'error';
        this.errorMessage = err.status === 400 && err.error?.error
          ? err.error.error
          : 'Could not check the available transfer speeds.';
        this.onValidatorChange();
        this.cdr.markForCheck();
      }
    });
  }

  private get amountInMinorUnits(): number | null {
    return typeof this.amount === 'number' && Number.isFinite(this.amount) ? Math.round(this.amount * 100) : null;
  }

  private formatAmount(minorUnits: number): string {
    const major = (minorUnits / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${major} ${this.currency}`;
  }
}
