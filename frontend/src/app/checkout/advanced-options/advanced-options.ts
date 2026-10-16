import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { AdvancedPaymentOptions, CaptureMode, CommissionType, FeeAllocation, SplitMode, SplitSettings } from '../../models';
import { formatMoney, fromMinorUnits, toMinorUnits } from '../../shared';
import { PaymentOutcome } from '../payment-outcome';

/** Card authorisations usually expire after 7 days. */
export const MAX_CAPTURE_DELAY_HOURS = 168;
export const MARKETPLACE_COMMISSION_PERCENTAGE = 10;

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

/**
 * Split fields. Checks are done at group level so the fields of the unused commission type
 * never block the form.
 */
export function createSplitForm(fb: FormBuilder, initial?: SplitSettings | null, currency?: string): FormGroup {
  return fb.nonNullable.group({
    commissionType: [initial?.commissionType ?? 'PERCENTAGE' as CommissionType],
    commissionPercentage: [initial?.commissionPercentage ?? MARKETPLACE_COMMISSION_PERCENTAGE as number | null],
    commissionAmount: [initial?.commissionAmount != null ? fromMinorUnits(initial.commissionAmount, currency) : null as number | null],
    feeAllocation: [initial?.feeAllocation ?? 'PLATFORM' as FeeAllocation],
  }, { validators: splitValidator });
}

/** Capture mode + optional custom split. The split group is disabled (ignored) until customSplit is on. */
export function createAdvancedOptionsForm(fb: FormBuilder): FormGroup {
  const group = fb.nonNullable.group({
    captureMode: ['IMMEDIATE' as CaptureMode],
    captureDelayHours: [24 as number | null],
    customSplit: [false],
    split: createSplitForm(fb),
  }, { validators: captureDelayValidator });
  enableWhen(group.get('customSplit')!, group.get('split')!);
  return group;
}

/** Disabled controls are left out of the validation, so the split fields only count while the toggle is on. */
export function enableWhen(toggle: AbstractControl, target: AbstractControl): void {
  const sync = (on: boolean) => on ? target.enable({ emitEvent: false }) : target.disable({ emitEvent: false });
  sync(!!toggle.value);
  toggle.valueChanges.subscribe(on => sync(!!on));
}

function splitValidator(control: AbstractControl): ValidationErrors | null {
  if (control.get('commissionType')?.value === 'FIXED') {
    const raw = control.get('commissionAmount')?.value;
    if (raw === null || raw === '' || !(Number(raw) >= 0)) {
      return { commissionAmount: 'Enter a commission of 0 or more.' };
    }
    if (!TWO_DECIMALS.test(String(raw))) {
      return { commissionAmount: 'Use up to 2 decimals.' };
    }
    return null;
  }
  const raw = control.get('commissionPercentage')?.value;
  const percentage = Number(raw);
  if (raw === null || raw === '' || !(percentage >= 0 && percentage <= 100)) {
    return { commissionPercentage: 'Enter a percentage between 0 and 100.' };
  }
  if (!TWO_DECIMALS.test(String(raw))) {
    return { commissionPercentage: 'Use up to 2 decimals.' };
  }
  return null;
}

function captureDelayValidator(control: AbstractControl): ValidationErrors | null {
  if (control.get('captureMode')?.value !== 'DELAYED') return null;
  const raw = control.get('captureDelayHours')?.value;
  const hours = Number(raw);
  return raw === null || raw === '' || !Number.isInteger(hours) || hours < 1 || hours > MAX_CAPTURE_DELAY_HOURS
    ? { captureDelayHours: `Enter a whole number of hours between 1 and ${MAX_CAPTURE_DELAY_HOURS}.` }
    : null;
}

/** Form-level check: a fixed commission can't be higher than the amount it applies to (both in major units). */
export function commissionWithinAmount(amountPath: string | string[], splitPath: string | string[]): ValidatorFn {
  return (form: AbstractControl): ValidationErrors | null => {
    const split = form.get(splitPath);
    if (!split || split.disabled || split.get('commissionType')?.value !== 'FIXED') return null;
    const amount = Number(form.get(amountPath)?.value);
    const commission = Number(split.get('commissionAmount')?.value);
    return amount > 0 && commission > amount ? { commissionTooHigh: true } : null;
  };
}

export function toSplitSettings(split: AbstractControl, currency: string): SplitSettings {
  const value = split.getRawValue();
  return value.commissionType === 'FIXED'
    ? { commissionType: 'FIXED', commissionAmount: toMinorUnits(Number(value.commissionAmount), currency), feeAllocation: value.feeAllocation }
    : { commissionType: 'PERCENTAGE', commissionPercentage: Number(value.commissionPercentage), feeAllocation: value.feeAllocation };
}

/** Undefined when nothing differs from the default behaviour, so the request stays unchanged. */
export function toAdvancedOptions(advanced: AbstractControl | null, currency: string): AdvancedPaymentOptions | undefined {
  if (!advanced) return undefined;
  const value = advanced.getRawValue();
  const customSplit = !!value.customSplit;
  if (value.captureMode === 'IMMEDIATE' && !customSplit) return undefined;
  return {
    captureMode: value.captureMode,
    captureDelayHours: value.captureMode === 'DELAYED' ? Number(value.captureDelayHours) : null,
    split: customSplit ? toSplitSettings(advanced.get('split')!, currency) : null,
  };
}

export interface SplitPreview {
  /** Minor units. */
  seller: number;
  commission: number;
  error?: string;
}

/**
 * Same rounding as the backend (half up). A fixed commission is defined for paymentAmount and
 * prorated when only part of it is captured.
 */
export function previewSplit(settings: SplitSettings, amount: number, paymentAmount: number = amount): SplitPreview | null {
  if (!(amount > 0)) return null;
  let commission: number;
  if (settings.commissionType === 'FIXED') {
    const fixed = Number(settings.commissionAmount);
    if (!Number.isFinite(fixed) || fixed < 0) return null;
    commission = amount === paymentAmount ? fixed : Math.round((fixed * amount) / paymentAmount);
  } else {
    const percentage = Number(settings.commissionPercentage);
    if (!Number.isFinite(percentage) || percentage < 0) return null;
    // Integer maths (hundredths of a percent) so x.5 results round like the backend BigDecimal.
    commission = Math.round((amount * Math.round(percentage * 100)) / 10000);
  }
  if (commission > amount) {
    return { seller: 0, commission, error: "The commission can't be higher than the amount." };
  }
  return { seller: amount - commission, commission };
}

export function feeAllocationLabel(allocation: FeeAllocation | null | undefined): string {
  return allocation === 'SUB_MERCHANT' ? 'Sub-merchant' : 'Platform';
}

/** "10% commission, fees paid by the platform" */
export function describeSplit(settings: SplitSettings | null | undefined, currency: string): string {
  if (!settings) return '';
  const commission = settings.commissionType === 'FIXED'
    ? `${formatMoney(settings.commissionAmount ?? 0, currency)} commission`
    : `${formatPercentage(settings.commissionPercentage)} commission`;
  return `${commission}, fees paid by the ${feeAllocationLabel(settings.feeAllocation).toLowerCase()}`;
}

export function formatPercentage(value: number | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

/** Split applied when no custom split is chosen, for the user's activity. */
export function defaultSplitDescription(activityReason: string | null | undefined): string {
  switch (activityReason) {
    case 'marketplace':
      return `Default: ${MARKETPLACE_COMMISSION_PERCENTAGE}% platform commission, the rest goes to the sub-merchant's balance account. Fees are paid by the platform.`;
    case 'embeddedPayment':
      return "Default: the split configuration of the store applies.";
    default:
      return 'Default: no split instructions, the funds go to the liable balance account.';
  }
}

export function describeSplitMode(mode: SplitMode, settings: SplitSettings | null | undefined, currency: string): string {
  switch (mode) {
    case 'CUSTOM':
      return `Custom split: ${describeSplit(settings, currency)}`;
    case 'MARKETPLACE_DEFAULT':
      return `Default split: ${describeSplit(settings, currency)}`;
    case 'STORE_PROFILE':
      return 'Split configuration of the store';
    default:
      return 'No split';
  }
}

/** Label of a split instruction sent to Adyen (BalanceAccount, Commission, PaymentFee). */
export function splitLineLabel(type: string | null | undefined): string {
  switch (type) {
    case 'BalanceAccount':
      return 'Sub-merchant';
    case 'Commission':
      return 'Platform commission';
    case 'PaymentFee':
      return 'Payment fees';
    default:
      return type || 'Split';
  }
}

export function describeCaptureMode(mode: CaptureMode, delayHours?: number | null): string {
  switch (mode) {
    case 'DELAYED':
      return `Automatic capture after ${delayHours} ${delayHours === 1 ? 'hour' : 'hours'}`;
    case 'MANUAL':
      return 'Manual capture';
    default:
      return 'Immediate capture';
  }
}

/** Extra sentence for the payment result when the payment isn't captured right away. */
export function captureNote(options: AdvancedPaymentOptions | undefined): string | null {
  switch (options?.captureMode) {
    case 'MANUAL':
      return 'It is only authorised: capture or cancel it from the Captures page.';
    case 'DELAYED':
      return `Adyen captures it automatically in ${options.captureDelayHours} ${options.captureDelayHours === 1 ? 'hour' : 'hours'}. You can capture or cancel it earlier from the Captures page.`;
    default:
      return null;
  }
}

/** Adds the capture note to an authorised payment that is listed on the Captures page. */
export function withCaptureNote(outcome: PaymentOutcome, options: AdvancedPaymentOptions | undefined, tracked: boolean): PaymentOutcome {
  const note = tracked && outcome.kind === 'success' ? captureNote(options) : null;
  return note ? { ...outcome, message: `${outcome.message} ${note}` } : outcome;
}
