import { LedgerAccount } from './ledger.model';

export interface CardExpenseReceipt {
  name: string;
  contentType: string;
  /** Bytes. */
  size: number;
  uploadedAt?: string | null;
}

/** How a card payment is booked. Amounts in minor units, those of the payment when it was classified. */
export interface CardExpense {
  id: number;
  transferId: string;
  paymentInstrumentId?: string | null;
  merchantName?: string | null;
  mcc?: string | null;
  /** outgoing for a payment, incoming for a refund. */
  direction?: string | null;
  /** Unsigned, tax included. */
  amount?: number | null;
  currency?: string | null;
  occurredAt?: string | null;
  /** The expense account, e.g. 6240. */
  category: string;
  categoryName: string;
  /** Percent, e.g. 20 or 5.5. */
  vatRate: number;
  /** The amount without tax. */
  net?: number | null;
  /** The tax included in the amount. */
  tax?: number | null;
  note?: string | null;
  receipt?: CardExpenseReceipt | null;
  /** A payment without its receipt. */
  receiptMissing: boolean;
  updatedAt?: string | null;
}

export interface CardExpenseRequest {
  category: string;
  vatRate: number;
  note?: string | null;
}

/** What the form of a card expense offers. */
export interface CardExpenseSettings {
  currency: string;
  /** VAT, GST or Sales tax. */
  taxLabel: string;
  /** The standard rate first. */
  vatRates: number[];
  defaultVatRate: number;
  categories: LedgerAccount[];
  /** The largest receipt accepted, in bytes. */
  maxReceiptBytes: number;
  /** The content types accepted, e.g. application/pdf. */
  receiptTypes: string[];
}

/** A receipt as the browser read it. */
export interface ReceiptUpload {
  fileName: string;
  /** A data URL, or the file in base64. */
  data: string;
}
