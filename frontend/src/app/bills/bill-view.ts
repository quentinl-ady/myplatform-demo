import { Bill, BillEvent, BillEventType, BillStatus, VopScenario } from '../models';
import { formatDate, parseServerDate } from '../shared';
import { StatusView, plural } from '../invoices/invoice-view';

/** The most transfers one batch takes: they're approved together, with one SCA. */
export const MAX_BATCH = 50;

export const BILL_STATUSES: Record<BillStatus, StatusView> = {
  TO_PAY: { label: 'To pay', icon: 'receipt_long', tone: 'info' },
  OVERDUE: { label: 'Overdue', icon: 'schedule', tone: 'danger' },
  PENDING_APPROVAL: { label: 'Awaiting approval', icon: 'pending_actions', tone: 'warning' },
  PROCESSING: { label: 'Processing', icon: 'sync', tone: 'info' },
  PAID: { label: 'Paid', icon: 'check_circle', tone: 'success' },
  FAILED: { label: 'Payment failed', icon: 'error_outline', tone: 'danger' },
};

const EVENT_VIEWS: Record<BillEventType, StatusView> = {
  CREATED: { label: 'Bill recorded', icon: 'note_add', tone: 'neutral' },
  UPDATED: { label: 'Bill updated', icon: 'edit', tone: 'neutral' },
  PAYEE_CHECKED: { label: 'Verification of Payee', icon: 'verified_user', tone: 'info' },
  TRANSFER_CREATED: { label: 'Transfer created', icon: 'pending_actions', tone: 'warning' },
  TRANSFER_APPROVED: { label: 'Transfer approved', icon: 'how_to_reg', tone: 'info' },
  TRANSFER_FAILED: { label: 'Transfer failed', icon: 'error_outline', tone: 'danger' },
  CARD_ISSUED: { label: 'Single-use card issued', icon: 'credit_card', tone: 'info' },
  CARD_CHARGED: { label: 'Card charged', icon: 'credit_score', tone: 'info' },
  CARD_REFUSED: { label: 'Card payment refused', icon: 'credit_card_off', tone: 'danger' },
  CARD_CLOSED: { label: 'Card closed', icon: 'credit_card_off', tone: 'neutral' },
  PAID: { label: 'Paid', icon: 'check_circle', tone: 'success' },
};

/** The backend records a cancelled transfer as a failed one, with this detail. */
const CANCELLED_TRANSFER = 'Transfer cancelled before its approval';
const PAYEE_CHECK_PREFIX = 'Verification of Payee. ';

const CARD_BRANDS: Record<string, string> = {
  mc: 'Mastercard',
  visa: 'Visa',
  maestro: 'Maestro',
  amex: 'American Express',
};

/** To pay, including after a failed payment. */
export function isOpen(bill: Bill): boolean {
  return bill.status === 'TO_PAY' || bill.status === 'OVERDUE' || bill.status === 'FAILED';
}

/** A transfer waits for its approval or for the bank, or a single-use card waits for the supplier. */
export function isInProgress(bill: Bill): boolean {
  return bill.status === 'PENDING_APPROVAL' || bill.status === 'PROCESSING';
}

/** The supplier charged the single-use card since it was issued. */
export function cardCharged(bill: Bill): boolean {
  for (let i = bill.events.length - 1; i >= 0; i--) {
    const type = bill.events[i].type;
    if (type === 'CARD_CHARGED') return true;
    if (type === 'CARD_ISSUED' || type === 'CARD_REFUSED') return false;
  }
  return false;
}

/** The status, with how the payment in progress is going. */
export function displayStatus(bill: Bill): StatusView {
  if (bill.status === 'PROCESSING') {
    if (bill.paymentMethod === 'CARD') {
      return cardCharged(bill)
        ? { label: 'Card charged', icon: 'credit_score', tone: 'info' }
        : { label: 'Card issued', icon: 'credit_card', tone: 'info' };
    }
    return { label: 'Transfer sent', icon: 'send', tone: 'info' };
  }
  return BILL_STATUSES[bill.status] ?? { label: bill.status, icon: 'help_outline', tone: 'neutral' };
}

export function eventView(event: BillEvent): StatusView {
  if (event.type === 'TRANSFER_FAILED' && event.detail?.startsWith(CANCELLED_TRANSFER)) {
    return { label: 'Transfer cancelled', icon: 'block', tone: 'neutral' };
  }
  return EVENT_VIEWS[event.type] ?? { label: event.type, icon: 'info_outline', tone: 'neutral' };
}

/** The detail of the event, without what its title already says. */
export function eventDetail(event: BillEvent): string {
  const detail = event.detail ?? '';
  return event.type === 'PAYEE_CHECKED' && detail.startsWith(PAYEE_CHECK_PREFIX)
    ? detail.slice(PAYEE_CHECK_PREFIX.length)
    : detail;
}

export function payeeCheckView(result: string | null | undefined): StatusView {
  switch (result) {
    case 'nameMatch':
      return { label: 'Name matches', icon: 'verified', tone: 'success' };
    case 'partialNameMatch':
      return { label: 'Close match', icon: 'rule', tone: 'warning' };
    case 'noNameMatch':
      return { label: 'No match', icon: 'gpp_bad', tone: 'danger' };
    case 'nameMatchNotSupported':
      return { label: 'Not checked by the bank', icon: 'help_outline', tone: 'neutral' };
    case 'notAvailable':
      return { label: 'Not available', icon: 'remove_moderator', tone: 'neutral' };
    case 'error':
      return { label: 'Check failed', icon: 'error_outline', tone: 'danger' };
    default:
      return { label: humanize(result) || 'Unknown', icon: 'help_outline', tone: 'neutral' };
  }
}

/** "Due in 5 days", "Overdue by 3 days", "Paid 12 Nov 2026". */
export function billDueText(bill: Bill, today: Date = new Date()): string {
  switch (bill.status) {
    case 'PAID':
      return bill.paidAt ? `Paid ${formatDate(bill.paidAt)}` : 'Paid';
    case 'OVERDUE':
      return `Overdue by ${plural(bill.daysOverdue ?? 0, 'day')}`;
    case 'PENDING_APPROVAL':
    case 'PROCESSING':
      return `Due ${formatDate(bill.dueDate)}`;
    default: {
      const due = parseServerDate(bill.dueDate);
      if (!due) return '';
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const days = Math.round((due.getTime() - start.getTime()) / 86_400_000);
      if (days < 0) return `Was due ${formatDate(bill.dueDate)}`;
      if (days === 0) return 'Due today';
      return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
    }
  }
}

export function paymentMethodLabel(bill: Bill): string {
  switch (bill.paymentMethod) {
    case 'TRANSFER':
      return 'Bank transfer';
    case 'CARD':
      return 'Single-use card';
    default:
      return 'Not paid yet';
  }
}

export function cardBrandName(brand: string | null | undefined): string {
  const code = (brand || '').trim().toLowerCase();
  if (!code) return 'card';
  return CARD_BRANDS[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

/** "pendingApproval" -> "Pending approval" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** TEST only: the Verification of Payee results a supplier's checks can simulate. */
export const VOP_SCENARIOS: { value: VopScenario | ''; label: string }[] = [
  { value: '', label: 'Regular check' },
  { value: 'partialNameMatch', label: 'Close match: the bank has a similar name' },
  { value: 'noNameMatch', label: 'No match: the bank has another name' },
  { value: 'nameMatchNotSupported', label: "Not supported by the supplier's bank" },
];

export function vopScenarioLabel(scenario: string | null | undefined): string {
  return VOP_SCENARIOS.find(option => option.value === (scenario ?? ''))?.label ?? humanize(scenario);
}
