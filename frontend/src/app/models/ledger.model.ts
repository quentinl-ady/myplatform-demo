/** SAL: the invoices issued. PUR: the supplier bills received. BNK: the movements of the Adyen balance accounts. */
export type LedgerJournal = 'SAL' | 'PUR' | 'BNK';

export type LedgerEntryKind =
  | 'INVOICE'
  | 'INVOICE_VOIDED'
  | 'BILL'
  | 'PAYMENT'
  | 'FEE'
  | 'REFUND'
  | 'CHARGEBACK'
  | 'PAYOUT'
  | 'TRANSFER'
  | 'BANK_TRANSFER'
  | 'CARD'
  | 'FINANCING'
  | 'OTHER';

/**
 * DOCUMENT: an invoice or a bill. MATCHED: a movement booked to its document, by a rule of the chart or to the category
 * of a card payment. TO_REVIEW: a movement booked to Suspense.
 */
export type LedgerEntryStatus = 'DOCUMENT' | 'MATCHED' | 'TO_REVIEW';

export interface LedgerAccount {
  code: string;
  name: string;
}

/** Amounts in minor units. */
export interface LedgerLine {
  account: string;
  accountName: string;
  /** What the line is for when the account doesn't say it, e.g. "VAT 20%". */
  label?: string | null;
  debit: number;
  credit: number;
}

/** A double-entry journal entry. Amounts in minor units. */
export interface LedgerEntry {
  id: string;
  /** yyyy-MM-dd */
  date: string;
  journal: LedgerJournal;
  kind: LedgerEntryKind;
  status: LedgerEntryStatus;
  description: string;
  /** The customer, the supplier, or the counterparty of the movement. */
  partner?: string | null;
  /** The number of the invoice or of the bill. */
  document?: string | null;
  invoiceId?: number | null;
  billId?: number | null;
  transferId?: string | null;
  pspReference?: string | null;
  balanceAccountId?: string | null;
  currency: string;
  /** The total of the debits. */
  amount: number;
  /** How the movement was matched, or why it wasn't. */
  note?: string | null;
  lines: LedgerLine[];
}

export interface LedgerTotal {
  currency: string;
  debit: number;
  credit: number;
}

export interface LedgerSummary {
  entries: number;
  /** The movements of the balance accounts in the journal. */
  movements: number;
  /** The movements booked to their document or by a rule. */
  matched: number;
  /** The movements booked to Suspense. */
  toReview: number;
  /** The percentage of the movements matched automatically; null without movements. */
  matchRate: number | null;
  /** The movements that aren't booked yet. */
  pending: number;
  /** Every entry has as many debits as credits. */
  balanced: boolean;
  /** One per currency. */
  totals: LedgerTotal[];
}

export interface LedgerAccountTotal {
  account: string;
  name: string;
  currency: string;
  debit: number;
  credit: number;
  /** The debits minus the credits. */
  balance: number;
}

/** A movement paid out. */
export interface LedgerPayoutItem {
  transferId: string;
  /** yyyy-MM-dd */
  date: string;
  kind: LedgerEntryKind;
  description: string;
  document?: string | null;
  /** Signed: positive when it credited the balance account. */
  amount: number;
}

/** A payout, and the movements booked on its balance account since the previous one. */
export interface LedgerPayout {
  transferId: string;
  /** yyyy-MM-dd */
  date: string;
  balanceAccountId: string;
  balanceAccount: string;
  /** The sub-account of the balance account, e.g. 1201. */
  account: string;
  /** Where the funds went, e.g. "Bank account" or the Business Bank Account. */
  destination: string;
  currency: string;
  amount: number;
  items: LedgerPayoutItem[];
  itemsTotal: number;
  /** The amount minus the sum of the movements. */
  difference: number;
  /** False when the previous payout is older than the movements read: the first movements may be missing. */
  sincePreviousPayout: boolean;
}

/** A movement of the period that Adyen hasn't booked yet, so not in the journal. */
export interface LedgerPendingMovement {
  transferId: string;
  /** yyyy-MM-dd */
  date: string;
  kind: LedgerEntryKind;
  description: string;
  document?: string | null;
  currency: string;
  /** Signed: positive when it will credit the balance account. */
  amount: number;
  /** As Adyen reports it, e.g. received, authorised or pendingApproval. */
  status: string;
}

/** The journal of a period, built again from Adyen at each call. */
export interface Ledger {
  /** yyyy-MM-dd */
  from: string;
  /** yyyy-MM-dd */
  to: string;
  currency: string;
  generatedAt: string;
  /** False when Adyen didn't return the movements: the journal only has the invoices and the bills. */
  movementsLoaded: boolean;
  /** What the journal is missing. */
  warnings: string[];
  summary: LedgerSummary;
  /** The chart of accounts, with one sub-account of 1200 per balance account. */
  accounts: LedgerAccount[];
  accountTotals: LedgerAccountTotal[];
  /** The latest first. */
  entries: LedgerEntry[];
  /** The latest first. */
  payouts: LedgerPayout[];
  pending: LedgerPendingMovement[];
}
