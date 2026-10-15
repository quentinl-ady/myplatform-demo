import { Pipe, PipeTransform } from '@angular/core';

// Adyen minor-unit exponents (https://docs.adyen.com/development-resources/currency-codes).
// They differ from ISO 4217 for a few currencies such as IDR and CVE.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'CVE', 'DJF', 'GNF', 'IDR', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export type MoneySignDisplay = 'auto' | 'always' | 'exceptZero' | 'never';

export function currencyExponent(currency: string | null | undefined): number {
  const code = (currency || '').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/** Converts a major-unit amount typed by the user (12.5) into Adyen minor units (1250). */
export function toMinorUnits(amount: number, currency: string | null | undefined): number {
  return Math.round(amount * Math.pow(10, currencyExponent(currency)));
}

export function fromMinorUnits(minorUnits: number, currency: string | null | undefined): number {
  return minorUnits / Math.pow(10, currencyExponent(currency));
}

/**
 * Formats an amount expressed in minor units, e.g. formatMoney(123456, 'EUR') -> "€1,234.56".
 * Use signDisplay 'exceptZero' to show "+€10.00" / "-€10.00" for credits and debits.
 */
export function formatMoney(
  minorUnits: number | null | undefined,
  currency: string | null | undefined,
  signDisplay: MoneySignDisplay = 'auto',
): string {
  if (minorUnits === null || minorUnits === undefined || !Number.isFinite(minorUnits)) {
    return '—';
  }
  const code = (currency || '').toUpperCase();
  const digits = currencyExponent(code);
  const value = fromMinorUnits(minorUnits, code);
  const base: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay,
  };
  if (!code) {
    return new Intl.NumberFormat('en-US', base).format(value);
  }
  try {
    return new Intl.NumberFormat('en-US', { ...base, style: 'currency', currency: code }).format(value);
  } catch {
    return `${new Intl.NumberFormat('en-US', base).format(value)} ${code}`;
  }
}

/** Template usage: {{ amountInMinorUnits | money:'EUR' }} or {{ value | money:currency:'exceptZero' }}. */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(
    minorUnits: number | null | undefined,
    currency: string | null | undefined,
    signDisplay: MoneySignDisplay = 'auto',
  ): string {
    return formatMoney(minorUnits, currency, signDisplay);
  }
}
