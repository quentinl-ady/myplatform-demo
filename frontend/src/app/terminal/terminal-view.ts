import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { Invoice, TerminalContext, TerminalResult } from '../models';
import { formatDate, formatDateTime, formatMoney, httpErrorMessage } from '../shared';
import { cardText } from '../checkout/payment-outcome';
import { Tone, refundText, refundView } from '../invoices/invoice-view';

/** The terminal app opens its settings for this link. */
export const APP_SETTINGS_URL = 'myplatform-terminal://settings';

/** Who the page works for, from its address: /terminal?terminalId=S1F2-000158213200001&api=…&app=android */
export interface TerminalSession {
  terminalId: string | null;
  /** The backend the page calls, without a trailing slash. */
  apiBase: string;
  /** Opened by the terminal app: its settings hold the terminal ID and the backend URL. */
  inApp: boolean;
}

export function sessionOf(params: { get(name: string): string | null }, defaultApi: string): TerminalSession {
  return {
    terminalId: params.get('terminalId')?.trim() || null,
    apiBase: apiBaseOf(params.get('api')) ?? defaultApi.replace(/\/+$/, ''),
    inApp: params.get('app') === 'android',
  };
}

/** An http(s) URL without its query and trailing slash; null when it isn't one. */
export function apiBaseOf(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** "Shop Paris · Paris" */
export function storeLabel(context: TerminalContext | null): string {
  return [context?.storeReference, context?.storeCity]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(' · ');
}

export interface Badge {
  label: string;
  tone: Tone;
}

export type InvoiceFilter = 'toCollect' | 'paid' | 'all';

export const INVOICE_FILTERS: readonly { id: InvoiceFilter; label: string }[] = [
  { id: 'toCollect', label: 'To collect' },
  { id: 'paid', label: 'Paid' },
  { id: 'all', label: 'All' },
];

/** Sent, overdue included: the customer still has to pay it. */
export function isOpen(invoice: Invoice): boolean {
  return invoice.status === 'SENT' || invoice.status === 'OVERDUE';
}

export function isPaid(invoice: Invoice): boolean {
  return invoice.status === 'PAID';
}

export function filterInvoices(invoices: Invoice[], filter: InvoiceFilter): Invoice[] {
  switch (filter) {
    case 'toCollect':
      return invoices.filter(isOpen);
    case 'paid':
      return invoices.filter(isPaid);
    default:
      return invoices;
  }
}

/** What the customer owes on an open invoice, else what it paid. */
export function amountOf(invoice: Invoice): number {
  return isOpen(invoice) ? invoice.amountDue : invoice.total;
}

/** What the refunds haven't given back yet. */
export function refundableAmount(invoice: Invoice): number {
  return Math.max(0, invoice.total - (invoice.refundedAmount ?? 0));
}

export function badgeOf(invoice: Invoice): Badge {
  if (isOpen(invoice)) {
    if (invoice.paymentLink?.status === 'paymentPending') return { label: 'Payment pending', tone: 'warning' };
    return invoice.status === 'OVERDUE' ? { label: 'Overdue', tone: 'danger' } : { label: 'Unpaid', tone: 'info' };
  }
  if (isPaid(invoice)) return refundView(invoice) ?? { label: 'Paid', tone: 'success' };
  return { label: invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase(), tone: 'neutral' };
}

/** "12 Nov 2026, 14:05 with Visa at terminal S1F2-000158213200001", null until the invoice is paid. */
export function paymentText(invoice: Invoice): string | null {
  if (!isPaid(invoice)) return null;
  const parts: string[] = [];
  const paidAt = formatDateTime(invoice.paidAt);
  if (paidAt) parts.push(paidAt);
  const method = invoice.paymentMethodName?.trim();
  if (method) parts.push(`with ${method}`);
  const terminal = invoice.terminalId?.trim();
  if (terminal) parts.push(`at terminal ${terminal}`);
  return parts.length ? parts.join(' ') : 'Paid';
}

/** Why the invoice can't be collected or refunded here now; null when it can, or when neither applies. */
export function blockedReason(invoice: Invoice): string | null {
  if (isOpen(invoice) && !invoice.terminalPayable) {
    return invoice.paymentLink?.status === 'paymentPending'
      ? 'The customer is paying with the payment link. Wait for that payment to finish.'
      : 'A payment of this invoice is in progress. Refresh in a moment.';
  }
  if (isPaid(invoice) && !invoice.refundable) {
    if (invoice.refund?.status === 'REQUESTED') return 'A refund is waiting for confirmation.';
    if (refundableAmount(invoice) <= 0) return 'The payment is fully refunded.';
    if (!invoice.pspReference?.trim()) return "This payment can't be refunded at a terminal.";
    return 'A refund of this invoice is in progress. Refresh in a moment.';
  }
  return null;
}

export interface DetailRow {
  label: string;
  value: string;
  /** A reference, shown in a fixed-width font. */
  mono?: boolean;
  danger?: boolean;
}

export function detailRows(invoice: Invoice): DetailRow[] {
  const rows: DetailRow[] = [{ label: 'Invoice', value: invoice.number }];
  const email = invoice.customer.email?.trim();
  if (email) rows.push({ label: 'Email', value: email });
  const issued = formatDate(invoice.issueDate);
  if (issued) rows.push({ label: 'Issue date', value: issued });
  const due = isOpen(invoice) ? formatDate(invoice.dueDate) : '';
  if (due) rows.push({ label: 'Due date', value: due });
  const payment = paymentText(invoice);
  if (payment) rows.push({ label: 'Payment', value: payment });
  const psp = invoice.pspReference?.trim();
  if (psp) rows.push({ label: 'PSP reference', value: psp, mono: true });
  return rows;
}

export interface RefundCard {
  badge: Badge;
  /** "€40.00 of €120.00 refunded" */
  text: string;
  rows: DetailRow[];
}

/** The refunds of the payment, null while nothing was refunded or requested. */
export function refundCard(invoice: Invoice): RefundCard | null {
  const badge = refundView(invoice);
  if (!badge) return null;
  const rows: DetailRow[] = [];
  const refund = invoice.refund;
  if (refund) {
    const requested = formatDateTime(refund.requestedAt);
    if (requested) rows.push({ label: 'Requested', value: requested });
    const terminal = refund.terminalId?.trim();
    if (terminal) rows.push({ label: 'Terminal', value: terminal, mono: true });
    const refunded = formatDateTime(refund.refundedAt);
    if (refunded) rows.push({ label: 'Refunded', value: refunded });
    const reason = refund.status === 'FAILED' ? refund.failureReason?.trim() : '';
    if (reason) rows.push({ label: 'Reason', value: reason, danger: true });
    const psp = refund.pspReference?.trim();
    if (psp) rows.push({ label: 'PSP reference', value: psp, mono: true });
  }
  return { badge: { label: badge.label, tone: badge.tone }, text: refundText(invoice), rows };
}

/**
 * offline: the device has no network, so the request didn't leave. network: the browser doesn't tell why the request
 * failed, so it may have reached the server.
 */
export type ApiErrorKind = 'offline' | 'network' | 'timeout' | 'rejected' | 'server';

/** A failed call to the backend, with a message for people. */
export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status: number | null;
}

/** What a server sends when it has nothing more specific to say. */
const GENERIC_REASONS = new Set([
  'bad request', 'not found', 'conflict', 'internal server error', 'bad gateway', 'service unavailable',
  'gateway timeout', 'request failed',
]);

/** @param inApp the backend URL can be changed in the settings of the terminal app */
export function apiError(err: unknown, inApp: boolean, online = typeof navigator === 'undefined' || navigator.onLine): ApiError {
  if (err instanceof TimeoutError) {
    return { kind: 'timeout', message: "The server didn't answer in time.", status: null };
  }
  if (!(err instanceof HttpErrorResponse)) {
    return { kind: 'network', message: 'Something went wrong. Try again.', status: null };
  }
  const status = err.status;
  if (status === 0) {
    if (!online) return { kind: 'offline', message: 'The terminal is offline. Check its network connection.', status };
    return {
      kind: 'network',
      message: inApp ? "Can't reach the server. Check the backend URL in Settings." : "Can't reach the server. Check the connection and try again.",
      status,
    };
  }
  if (status >= 200 && status < 300) {
    // An answer that isn't JSON, e.g. the login page of a Wi-Fi network.
    return { kind: 'server', message: "The server's answer couldn't be read.", status };
  }
  const reason = httpErrorMessage(err, '').trim();
  const detail = reason && !GENERIC_REASONS.has(reason.toLowerCase()) ? reason : null;
  if (status >= 400 && status < 500) {
    return { kind: 'rejected', message: detail ?? rejectedMessage(status), status };
  }
  return { kind: 'server', message: detail ?? serverMessage(status), status };
}

function rejectedMessage(status: number): string {
  switch (status) {
    case 404:
      return 'Not found.';
    case 409:
      return "This can't be done right now. Refresh and try again.";
    default:
      return 'The server refused the request.';
  }
}

function serverMessage(status: number): string {
  return status === 502 || status === 503 || status === 504
    ? "The server isn't available right now. Try again in a minute."
    : 'Something went wrong on the server.';
}

export type Operation = 'payment' | 'refund';

export type ResultKind = 'success' | 'failure' | 'cancelled' | 'error' | 'unknown';

export interface ResultView {
  kind: ResultKind;
  title: string;
  message: string;
  /** Nothing was charged or refunded: the same operation can be sent again. */
  retry: boolean;
  /** Something to act on, e.g. a second payment of the invoice. */
  warning?: string | null;
  /** "Visa •••• 1111" */
  card?: string | null;
  pspReference?: string | null;
}

/**
 * How the terminal answered.
 *
 * @param amount the amount that was collected or refunded, formatted
 * @param number the number of the invoice
 */
export function resultView(operation: Operation, result: TerminalResult, amount: string, number: string): ResultView {
  const message = result.message?.trim() ? sentence(result.message.trim()) : null;
  if (operation === 'refund') {
    switch (result.outcome) {
      case 'REQUESTED':
        return {
          kind: 'success', title: 'Refund requested', retry: false, pspReference: result.pspReference ?? null,
          message: `${amount} goes back to the card the customer paid with. The invoice shows Refunded once the refund is confirmed.`,
        };
      case 'DECLINED':
      case 'CANCELLED':
        return {
          kind: 'failure', title: 'Refund declined', retry: true,
          message: `${message ?? 'The refund was refused.'} Nothing was refunded.`,
        };
      case 'ERROR':
        return {
          kind: 'error', title: "The refund didn't start", retry: true,
          message: `${message ?? "The terminal didn't take the refund."} Nothing was refunded.`,
        };
      default:
        return {
          kind: 'unknown', title: 'Status unknown', retry: false,
          message: `${message ?? 'The answer of the terminal was lost.'} The invoice shows the refund once it's confirmed.`,
        };
    }
  }
  const card = cardText(result.cardBrand, result.maskedPan);
  switch (result.outcome) {
    case 'APPROVED':
      return {
        kind: 'success', title: 'Payment approved', message: `${number} is paid: ${amount}.`, retry: false,
        warning: message, card, pspReference: result.pspReference ?? null,
      };
    case 'DECLINED':
      return {
        kind: 'failure', title: 'Payment declined', retry: true, card,
        message: `${message ?? 'The card was declined.'} No money was taken.`,
      };
    case 'CANCELLED':
      return { kind: 'cancelled', title: 'Payment cancelled', message: 'No money was taken.', retry: true };
    case 'ERROR':
      return {
        kind: 'error', title: "The payment didn't start", retry: true,
        message: `${message ?? "The terminal didn't take the payment."} Nothing was charged.`,
      };
    default:
      return {
        kind: 'unknown', title: 'Status unknown', retry: false,
        message: `${message ?? 'The answer of the terminal was lost.'} If the customer paid, the invoice turns to Paid on its own.`,
      };
  }
}

/** The backend didn't answer: unless it refused the request, the terminal may have taken the payment or refund. */
export function errorResultView(operation: Operation, error: ApiError): ResultView {
  const payment = operation === 'payment';
  const settled = payment
    ? 'Check the invoice before collecting it again: if the customer paid, it turns to Paid on its own.'
    : "Check the invoice before refunding it again: it shows the refund once it's confirmed.";
  const message = sentence(error.message.trim());
  switch (error.kind) {
    case 'rejected':
      return {
        kind: 'error', title: payment ? "Couldn't start the payment" : "Couldn't start the refund", message,
        retry: error.status !== 404,
      };
    case 'offline':
      return {
        kind: 'error', title: "Couldn't reach the server", retry: true,
        message: `${message} ${payment ? 'Nothing was charged.' : 'Nothing was refunded.'}`,
      };
    case 'network':
      return { kind: 'unknown', title: 'Status unknown', retry: false, message: `The connection to the server was lost. ${settled}` };
    default:
      return { kind: 'unknown', title: 'Status unknown', retry: false, message: `${message} ${settled}` };
  }
}

/** "Collecting €120.00", "Refunding €120.00" */
export function waitingTitle(operation: Operation, amount: number, currency: string | null | undefined): string {
  return `${operation === 'refund' ? 'Refunding' : 'Collecting'} ${formatMoney(amount, currency)}`;
}

/** The messages are followed by another sentence: they need their period, which a reason may lack. */
function sentence(text: string): string {
  return !text || /[.!?]$/.test(text) ? text : `${text}.`;
}
