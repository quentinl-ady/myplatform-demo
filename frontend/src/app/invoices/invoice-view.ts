import { Invoice, InvoiceCharge, InvoiceEvent, InvoiceEventType, InvoiceStatus } from '../models';
import { formatDate, parseServerDate } from '../shared';
import { PHONE_COUNTRIES } from '../shared/phone';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusView {
  label: string;
  icon: string;
  tone: Tone;
}

export const INVOICE_STATUSES: Record<InvoiceStatus, StatusView> = {
  DRAFT: { label: 'Draft', icon: 'edit_note', tone: 'neutral' },
  SENT: { label: 'Sent', icon: 'send', tone: 'info' },
  OVERDUE: { label: 'Overdue', icon: 'schedule', tone: 'danger' },
  PAID: { label: 'Paid', icon: 'check_circle', tone: 'success' },
  VOID: { label: 'Void', icon: 'block', tone: 'neutral' },
};

export const EVENT_VIEWS: Record<InvoiceEventType, StatusView> = {
  CREATED: { label: 'Draft created', icon: 'note_add', tone: 'neutral' },
  UPDATED: { label: 'Draft updated', icon: 'edit', tone: 'neutral' },
  SENT: { label: 'Sent', icon: 'send', tone: 'info' },
  LINK_RENEWED: { label: 'New payment link', icon: 'link', tone: 'info' },
  LINK_EXPIRED: { label: 'Payment link expired', icon: 'link_off', tone: 'warning' },
  PAYMENT_PENDING: { label: 'Payment pending', icon: 'hourglass_top', tone: 'warning' },
  PAYMENT_REFUSED: { label: 'Payment refused', icon: 'error_outline', tone: 'danger' },
  PAID: { label: 'Paid', icon: 'check_circle', tone: 'success' },
  VOIDED: { label: 'Voided', icon: 'block', tone: 'neutral' },
  CHARGE_SUBMITTED: { label: 'Charge submitted', icon: 'autorenew', tone: 'info' },
  REFUNDED: { label: 'Refunded', icon: 'undo', tone: 'neutral' },
};

export function statusOf(invoice: Invoice): StatusView {
  return INVOICE_STATUSES[invoice.status] ?? { label: invoice.status, icon: 'help_outline', tone: 'neutral' };
}

/** The status, with the state of the payment link or of the subscription charge while the invoice is unpaid. */
export function displayStatus(invoice: Invoice): StatusView {
  if (invoice.status === 'SENT' || invoice.status === 'OVERDUE') {
    switch (invoice.paymentLink?.status) {
      case 'paymentPending':
        return { label: 'Payment pending', icon: 'hourglass_top', tone: 'warning' };
      case 'expired':
        return { label: 'Link expired', icon: 'link_off', tone: 'warning' };
    }
    switch (invoice.charge?.status) {
      case 'PENDING':
        return { label: 'Charge pending', icon: 'hourglass_top', tone: 'warning' };
      case 'RESCUING':
        return { label: 'Auto Rescue retrying', icon: 'healing', tone: 'warning' };
    }
    // Once a payment link is sent for it, the invoice is awaiting that payment.
    if (invoice.charge?.status === 'REFUSED' && !invoice.paymentLink) {
      return { label: 'Charge refused', icon: 'error_outline', tone: 'danger' };
    }
  }
  return statusOf(invoice);
}

/** The last charge of a subscription invoice, e.g. "Refused: Not enough balance". */
export function chargeText(charge: InvoiceCharge): string {
  const reason = charge.refusalReason ? `: ${charge.refusalReason}` : '';
  const attempts = charge.attempts > 1 ? ` after ${charge.attempts} attempts` : '';
  switch (charge.status) {
    case 'AUTHORISED':
      return `Authorised${attempts}`;
    case 'PENDING':
      return 'Awaiting confirmation';
    case 'RESCUING':
      return `Refused${reason}. Auto Rescue is retrying it.`;
    case 'REFUSED':
      return `Refused${attempts}${reason}`;
    default:
      return charge.status;
  }
}

export function eventView(event: InvoiceEvent): StatusView {
  return EVENT_VIEWS[event.type] ?? { label: event.type, icon: 'info_outline', tone: 'neutral' };
}

export function linkTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'completed':
    case 'paid':
      return 'success';
    case 'paymentPending':
      return 'warning';
    case 'expired':
      return 'neutral';
    default:
      return 'info';
  }
}

/** A sent invoice whose payment link can still be paid. */
export function awaitingPayment(invoice: Invoice): boolean {
  return (invoice.status === 'SENT' || invoice.status === 'OVERDUE')
    && !!invoice.paymentLink && invoice.paymentLink.status !== 'expired';
}

export function linkStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'paymentPending':
      return 'Payment pending';
    case 'completed':
    case 'paid':
      return 'Paid';
    case 'expired':
      return 'Expired';
    default:
      return status || 'Unknown';
  }
}

/** "Due today", "Due in 5 days", "Overdue by 3 days", "Paid 12 Nov 2026". */
export function dueText(invoice: Invoice, today: Date = new Date()): string {
  switch (invoice.status) {
    case 'PAID':
      return invoice.paidAt ? `Paid ${formatDate(invoice.paidAt)}` : 'Paid';
    case 'VOID':
      return invoice.voidedAt ? `Voided ${formatDate(invoice.voidedAt)}` : 'Void';
    case 'OVERDUE': {
      const days = invoice.daysOverdue ?? 0;
      return `Overdue by ${plural(days, 'day')}`;
    }
    default: {
      const due = parseServerDate(invoice.dueDate);
      if (!due) return '';
      const days = Math.round((due.getTime() - startOfDay(today).getTime()) / 86_400_000);
      if (days <= 0) return 'Due today';
      return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
    }
  }
}

/** "20%", "5.5%" */
export function formatRate(rate: number | null | undefined): string {
  return `${Number(rate ?? 0)}%`;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The local date as yyyy-MM-dd. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const date = parseServerDate(iso) ?? new Date();
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface LineAmounts {
  net: number;
  tax: number;
  gross: number;
}

/** Same rule as the backend: the tax of each line is rounded half up. Amounts in minor units. */
export function lineAmounts(quantity: number, unitPrice: number, vatRate: number): LineAmounts {
  const net = quantity * unitPrice;
  const basisPoints = Math.round(vatRate * 100);
  const tax = Math.floor((net * basisPoints + 5000) / 10000);
  return { net, tax, gross: net + tax };
}

/** Same rule as the backend: the tax included in an amount is rounded half up. Amounts in minor units. */
export function grossAmounts(gross: number, vatRate: number): LineAmounts {
  const basisPoints = Math.round(vatRate * 100);
  const divisor = 10000 + basisPoints;
  const tax = gross > 0 ? Math.floor((2 * gross * basisPoints + divisor) / (2 * divisor)) : 0;
  return { net: gross - tax, tax, gross };
}

export interface VatGroup {
  rate: number;
  base: number;
  tax: number;
}

export interface Totals extends LineAmounts {
  /** One group per rate, the highest rate first. */
  vat: VatGroup[];
}

export function totalsOf(lines: { rate: number; amounts: LineAmounts }[]): Totals {
  const groups = new Map<number, VatGroup>();
  let net = 0;
  let tax = 0;
  for (const { rate, amounts } of lines) {
    net += amounts.net;
    tax += amounts.tax;
    const group = groups.get(rate) ?? { rate, base: 0, tax: 0 };
    group.base += amounts.net;
    group.tax += amounts.tax;
    groups.set(rate, group);
  }
  const vat = [...groups.values()].sort((a, b) => b.rate - a.rate);
  return { net, tax, gross: net + tax, vat };
}

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface CountryOption {
  code: string;
  name: string;
}

/** The countries a customer can be in, with the given ones added when they're missing. */
export function customerCountries(...extra: (string | null | undefined)[]): CountryOption[] {
  const options: CountryOption[] = PHONE_COUNTRIES.map(country => ({ code: country.code, name: country.name }));
  for (const code of extra) {
    if (code && !options.some(option => option.code === code)) {
      options.push({ code, name: countryName(code) });
    }
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}
