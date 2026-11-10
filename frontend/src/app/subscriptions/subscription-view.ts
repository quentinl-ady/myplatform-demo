import {
  CustomerSubscription, SubscriptionEvent, SubscriptionEventType, SubscriptionFrequency, SubscriptionInvoice,
  SubscriptionStatus, SubscriptionTestOutcome
} from '../models';
import { formatDate, parseServerDate } from '../shared';
import { INVOICE_STATUSES, StatusView } from '../invoices/invoice-view';

export const SUBSCRIPTION_STATUSES: Record<SubscriptionStatus, StatusView> = {
  AWAITING_PAYMENT_METHOD: { label: 'Awaiting payment method', icon: 'hourglass_top', tone: 'warning' },
  ACTIVE: { label: 'Active', icon: 'autorenew', tone: 'success' },
  PAST_DUE: { label: 'Past due', icon: 'error_outline', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', icon: 'block', tone: 'neutral' },
};

export const SUBSCRIPTION_EVENT_VIEWS: Record<SubscriptionEventType, StatusView> = {
  CREATED: { label: 'Subscription created', icon: 'add_circle_outline', tone: 'neutral' },
  UPDATED: { label: 'Subscription updated', icon: 'edit', tone: 'neutral' },
  CYCLE_BILLED: { label: 'Cycle invoiced', icon: 'request_quote', tone: 'neutral' },
  INVOICE_SENT: { label: 'Payment link sent', icon: 'send', tone: 'info' },
  PAID: { label: 'Invoice paid', icon: 'check_circle', tone: 'success' },
  PAYMENT_METHOD_STORED: { label: 'Payment method stored', icon: 'credit_card', tone: 'success' },
  ACTIVATED: { label: 'Active', icon: 'autorenew', tone: 'success' },
  CHARGED: { label: 'Charged', icon: 'check_circle', tone: 'success' },
  CHARGE_PENDING: { label: 'Charge pending', icon: 'hourglass_top', tone: 'warning' },
  CHARGE_REFUSED: { label: 'Charge refused', icon: 'error_outline', tone: 'danger' },
  CHARGE_FAILED: { label: 'Charge rejected', icon: 'report', tone: 'danger' },
  RESCUE_STOPPED: { label: 'Auto Rescue stopped', icon: 'stop_circle', tone: 'neutral' },
  RESCUE_ENDED: { label: 'Auto Rescue ended', icon: 'healing', tone: 'warning' },
  PAST_DUE: { label: 'Past due', icon: 'error_outline', tone: 'danger' },
  REACTIVATED: { label: 'Active again', icon: 'autorenew', tone: 'success' },
  CANCELLED: { label: 'Cancelled', icon: 'block', tone: 'neutral' },
};

export function subscriptionStatus(subscription: CustomerSubscription): StatusView {
  return SUBSCRIPTION_STATUSES[subscription.status] ?? { label: subscription.status, icon: 'help_outline', tone: 'neutral' };
}

export function subscriptionEventView(event: SubscriptionEvent): StatusView {
  return SUBSCRIPTION_EVENT_VIEWS[event.type] ?? { label: event.type, icon: 'info_outline', tone: 'neutral' };
}

export function unpaid(invoice: SubscriptionInvoice): boolean {
  return invoice.status === 'DRAFT' || invoice.status === 'SENT' || invoice.status === 'OVERDUE';
}

/** The status of the invoice of a cycle, with its charge while it's unpaid. */
export function cycleStatus(invoice: SubscriptionInvoice): StatusView {
  if (unpaid(invoice)) {
    switch (invoice.chargeStatus) {
      case 'PENDING':
        return { label: 'Charge pending', icon: 'hourglass_top', tone: 'warning' };
      case 'RESCUING':
        return { label: 'Auto Rescue retrying', icon: 'healing', tone: 'warning' };
      case 'REFUSED':
        return invoice.paymentLinkUrl
          ? { label: 'Payment link sent', icon: 'send', tone: 'info' }
          : { label: 'Charge refused', icon: 'error_outline', tone: 'danger' };
    }
  }
  return INVOICE_STATUSES[invoice.status] ?? { label: invoice.status, icon: 'help_outline', tone: 'neutral' };
}

export function rescuing(invoice: SubscriptionInvoice): boolean {
  return unpaid(invoice) && invoice.chargeStatus === 'RESCUING';
}

export function firstInvoice(subscription: CustomerSubscription): SubscriptionInvoice | null {
  return subscription.invoices.find(invoice => invoice.cycle === 1) ?? null;
}

/** The unpaid invoice of the latest cycle after the first: it's charged again instead of billing a new cycle. */
export function openInvoice(subscription: CustomerSubscription): SubscriptionInvoice | null {
  return subscription.invoices.find(invoice => invoice.cycle > 1 && unpaid(invoice)) ?? null;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** Same rule as the invoice lines: "1–31 Dec 2026", "15 Nov – 14 Dec 2026", "15 Dec 2026 – 14 Jan 2027". */
export function periodText(invoice: SubscriptionInvoice): string {
  const start = parseServerDate(invoice.periodStart);
  const end = parseServerDate(invoice.periodEnd);
  if (!start || !end) return '';
  if (start.getFullYear() !== end.getFullYear()) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start.getMonth() !== end.getMonth()) return `${DAY_MONTH.format(start)} – ${formatDate(end)}`;
  return `${DAY.format(start)}–${formatDate(end)}`;
}

/** What comes next for the subscription, next to its status in the list. */
export function nextStepText(subscription: CustomerSubscription): string {
  switch (subscription.status) {
    case 'AWAITING_PAYMENT_METHOD': {
      const first = firstInvoice(subscription);
      if (!first) return '';
      if (first.status === 'PAID') return 'First invoice paid';
      return first.paymentLinkUrl ? 'First invoice sent' : 'First invoice not sent';
    }
    case 'ACTIVE':
      return `Next cycle ${formatDate(subscription.nextBillingDate)}`;
    case 'PAST_DUE': {
      const retried = subscription.invoices.find(rescuing);
      if (retried) return `Auto Rescue retrying ${retried.number}`;
      const open = openInvoice(subscription);
      return open ? `${open.number} unpaid` : '';
    }
    case 'CANCELLED':
      return subscription.cancelledAt ? `Ended ${formatDate(subscription.cancelledAt)}` : '';
    default:
      return '';
  }
}

/** "month" or "year" */
export function periodNoun(frequency: SubscriptionFrequency): string {
  return frequency === 'YEARLY' ? 'year' : 'month';
}

/** What the subscription adds to the monthly recurring revenue: its price per month, excluding tax. */
export function monthlyRevenue(subscription: CustomerSubscription): number {
  return subscription.frequency === 'YEARLY' ? Math.round(subscription.price / 12) : subscription.price;
}

/**
 * Adyen is settling something the page shows: the first payment and the payment method it stores, a charge, an Auto
 * Rescue, or the payment link of a refused charge.
 */
export function settling(subscription: CustomerSubscription): boolean {
  if (subscription.status === 'CANCELLED') return false;
  if (subscription.status === 'AWAITING_PAYMENT_METHOD') {
    const first = firstInvoice(subscription);
    return !!first && (first.status === 'PAID' || !!first.paymentLinkUrl);
  }
  return subscription.invoices.some(invoice => unpaid(invoice)
    && (invoice.chargeStatus === 'PENDING' || invoice.chargeStatus === 'RESCUING' || !!invoice.paymentLinkUrl));
}

export interface OutcomeOption {
  value: SubscriptionTestOutcome;
  label: string;
  hint: string;
}

const REFUSALS: OutcomeOption[] = [
  { value: 'REFUSED', label: 'Refused', hint: 'The issuer refuses the charge.' },
  { value: 'NOT_ENOUGH_BALANCE', label: 'Not enough balance', hint: 'The account has too little money.' },
  { value: 'EXPIRED_CARD', label: 'Expired card', hint: 'The card expired since it was stored.' },
];

const RESCUE_SCENARIOS: OutcomeOption[] = [
  { value: 'RESCUED_FIRST_RETRY', label: 'Rescued on the first retry', hint: 'Refused, then paid on retry.' },
  { value: 'RESCUED_SECOND_RETRY', label: 'Rescued on the second retry', hint: 'Refused twice, then paid.' },
  { value: 'NOT_RESCUED', label: 'Not rescued', hint: 'Every retry is refused.' },
  { value: 'FRAUD', label: 'Refused as fraud', hint: "Auto Rescue doesn't retry it." },
];

/**
 * The TEST outcomes the next charge can simulate. With Auto Rescue, its scenarios: Adyen plays them within minutes,
 * where a plain refusal would be retried over days.
 */
export function testOutcomes(subscription: CustomerSubscription): OutcomeOption[] {
  if (!subscription.cardOutcomes) return [];
  return subscription.autoRescue ? RESCUE_SCENARIOS : REFUSALS;
}
