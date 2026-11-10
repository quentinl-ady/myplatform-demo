import { Ledger, LedgerEntry, LedgerEntryKind, LedgerEntryStatus, LedgerJournal, LedgerPayout } from '../models';
import { formatMoney } from '../shared';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type JournalFilter = 'all' | LedgerJournal | 'TO_REVIEW';

export interface KindView {
  label: string;
  icon: string;
}

export interface StatusView {
  label: string;
  tone: Tone;
}

/** The periods the journal can cover, in days. The backend reads at most 90 days. */
export const PERIODS = [7, 30, 90] as const;

export const JOURNAL_NAMES: Record<LedgerJournal, string> = {
  SAL: 'Sales journal: the invoices you issued',
  PUR: 'Purchases journal: the supplier bills you received',
  BNK: 'Bank journal: the movements of your balance accounts',
};

const KINDS: Record<LedgerEntryKind, KindView> = {
  INVOICE: { label: 'Invoice', icon: 'request_quote' },
  INVOICE_VOIDED: { label: 'Invoice voided', icon: 'block' },
  BILL: { label: 'Bill', icon: 'receipt' },
  PAYMENT: { label: 'Payment', icon: 'payments' },
  FEE: { label: 'Fees', icon: 'percent' },
  REFUND: { label: 'Refund', icon: 'undo' },
  CHARGEBACK: { label: 'Chargeback', icon: 'gavel' },
  PAYOUT: { label: 'Payout', icon: 'account_balance' },
  TRANSFER: { label: 'Transfer between balance accounts', icon: 'sync_alt' },
  BANK_TRANSFER: { label: 'Bank transfer', icon: 'swap_horiz' },
  CARD: { label: 'Card', icon: 'credit_card' },
  FINANCING: { label: 'Financing', icon: 'savings' },
  OTHER: { label: 'Other movement', icon: 'help_outline' },
};

const STATUSES: Record<LedgerEntryStatus, StatusView> = {
  DOCUMENT: { label: 'Document', tone: 'info' },
  MATCHED: { label: 'Matched', tone: 'success' },
  TO_REVIEW: { label: 'To review', tone: 'warning' },
};

const PENDING_STATUSES: Record<string, string> = {
  received: 'Received',
  authorised: 'Authorised',
  captured: 'Captured',
  pendingApproval: 'Pending approval',
  approvalPending: 'Pending approval',
};

export function kindView(kind: LedgerEntryKind): KindView {
  return KINDS[kind] ?? { label: kind, icon: 'receipt' };
}

export function statusView(status: LedgerEntryStatus): StatusView {
  return STATUSES[status] ?? { label: status, tone: 'neutral' };
}

export function journalName(journal: LedgerJournal): string {
  return JOURNAL_NAMES[journal] ?? journal;
}

/** "Captured", "Refund pending" */
export function pendingStatusLabel(status: string): string {
  if (PENDING_STATUSES[status]) return PENDING_STATUSES[status];
  const words = status.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function matchesFilter(entry: LedgerEntry, filter: JournalFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'TO_REVIEW':
      return entry.status === 'TO_REVIEW';
    default:
      return entry.journal === filter;
  }
}

/** Searches what the entry says, its references and its accounts: "INV-2026", "Acme", "1900", "fees". */
export function matchesQuery(entry: LedgerEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    entry.id, entry.description, entry.partner, entry.document, entry.transferId, entry.pspReference, entry.note,
    kindView(entry.kind).label,
    ...entry.lines.flatMap(line => [line.account, line.accountName, line.label]),
  ].filter(Boolean).join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

export function debitsOf(entry: LedgerEntry): number {
  return entry.lines.reduce((sum, line) => sum + line.debit, 0);
}

export function creditsOf(entry: LedgerEntry): number {
  return entry.lines.reduce((sum, line) => sum + line.credit, 0);
}

/** An account of the chart with its totals over the period in one currency; no totals when nothing was booked to it. */
export interface ChartRow {
  code: string;
  name: string;
  currency: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

/** The chart of accounts in code order, one row per currency an account was booked in. */
export function chartRows(ledger: Ledger): ChartRow[] {
  const totals = new Map<string, ChartRow[]>();
  for (const total of ledger.accountTotals) {
    const rows = totals.get(total.account) ?? [];
    rows.push({
      code: total.account, name: total.name, currency: total.currency,
      debit: total.debit, credit: total.credit, balance: total.balance,
    });
    totals.set(total.account, rows);
  }
  const rows: ChartRow[] = [];
  const listed = new Set<string>();
  for (const account of ledger.accounts) {
    listed.add(account.code);
    const booked = totals.get(account.code);
    if (booked?.length) {
      rows.push(...booked.map(row => ({ ...row, name: account.name })));
    } else {
      rows.push({ code: account.code, name: account.name, currency: null, debit: null, credit: null, balance: null });
    }
  }
  for (const [code, booked] of totals) {
    if (!listed.has(code)) rows.push(...booked);
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** "€120.00 Dr" for a debit balance, "€80.00 Cr" for a credit balance. */
export function balanceText(balance: number | null, currency: string | null): string {
  if (balance === null || !currency) return '';
  if (balance === 0) return formatMoney(0, currency);
  return `${formatMoney(Math.abs(balance), currency)} ${balance > 0 ? 'Dr' : 'Cr'}`;
}

export interface PayoutCheck extends StatusView {
  icon: string;
}

/** Whether the movements add up to the payout. */
export function payoutCheck(payout: LedgerPayout): PayoutCheck {
  if (payout.difference === 0) {
    return { label: 'Reconciled', tone: 'success', icon: 'task_alt' };
  }
  if (!payout.sincePreviousPayout) {
    return { label: 'Earlier movements not read', tone: 'info', icon: 'history' };
  }
  return {
    label: `Difference ${formatMoney(payout.difference, payout.currency, 'exceptZero')}`,
    tone: 'warning',
    icon: 'rule',
  };
}

/** Why the movements don't add up to the payout. */
export function payoutExplanation(payout: LedgerPayout): string {
  if (payout.difference === 0) return '';
  if (!payout.sincePreviousPayout) {
    return 'Movements from before the period are missing. Choose a longer period.';
  }
  return 'The balance account kept part of the funds, or had funds before the first movement listed.';
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
