import { LedgerAccount } from './ledger.model';
import { BankAccountFormat, RecipientCountry, TransferPriority } from './transfer.model';

/**
 * OVERDUE is a bill to pay past its due date. PENDING_APPROVAL: its transfer waits for an approval with SCA.
 * PROCESSING: the transfer was approved, or the single-use card was issued. FAILED: to pay again.
 */
export type BillStatus = 'TO_PAY' | 'OVERDUE' | 'PENDING_APPROVAL' | 'PROCESSING' | 'PAID' | 'FAILED';

export type BillPaymentMethod = 'TRANSFER' | 'CARD';

export type BillEventType =
  | 'CREATED'
  | 'UPDATED'
  | 'PAYEE_CHECKED'
  | 'TRANSFER_CREATED'
  | 'TRANSFER_APPROVED'
  | 'TRANSFER_FAILED'
  | 'CARD_ISSUED'
  | 'CARD_CHARGED'
  | 'CARD_REFUSED'
  | 'CARD_CLOSED'
  | 'PAID';

/**
 * The Verification of Payee result as Adyen returns it. notAvailable: the banks of the supplier's country don't check
 * names. error: the check failed.
 */
export type PayeeCheckResult =
  | 'nameMatch'
  | 'partialNameMatch'
  | 'noNameMatch'
  | 'nameMatchNotSupported'
  | 'notAvailable'
  | 'error';

/** TEST only: the Verification of Payee result the checks of a supplier simulate. */
export type VopScenario = 'nameMatch' | 'partialNameMatch' | 'noNameMatch' | 'nameMatchNotSupported';

/** The supplier as the bill shows it. */
export interface BillSupplier {
  id: number;
  name: string;
  email?: string | null;
  country?: string | null;
  /** Only its last digits, e.g. "FR76 •••• 9742"; null without bank details. */
  bankAccount?: string | null;
  bankCountry?: string | null;
}

/** The single-use card that pays the bill. */
export interface BillCard {
  paymentInstrumentId: string;
  /** e.g. mc or visa */
  brand?: string | null;
  lastFour?: string | null;
  /** active until the payment is booked, then closed. */
  status?: string | null;
}

/** The last Verification of Payee of the supplier. */
export interface BillPayeeCheck {
  result: PayeeCheckResult | string;
  /** The name the supplier's bank has, for a partial match. */
  name?: string | null;
  checkedAt?: string | null;
}

export interface BillEvent {
  type: BillEventType;
  occurredAt: string;
  detail?: string | null;
  transferId?: string | null;
}

/** A supplier bill, paid by transfer or with a single-use card. Amounts in minor units. */
export interface Bill {
  id: number;
  number: string;
  /** The number of the supplier's invoice. */
  supplierReference?: string | null;
  status: BillStatus;
  daysOverdue?: number | null;
  supplier: BillSupplier;
  /** yyyy-MM-dd */
  issueDate: string;
  /** yyyy-MM-dd */
  dueDate: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  /** Percent, e.g. 20 or 5.5. */
  vatRate: number;
  /** The expense account, e.g. 6210. */
  category: string;
  categoryName: string;
  description?: string | null;
  /** Null until a payment starts. */
  paymentMethod?: BillPaymentMethod | null;
  transferId?: string | null;
  /** As Adyen last reported it, e.g. received, authorised or booked. */
  transferStatus?: string | null;
  card?: BillCard | null;
  payeeCheck?: BillPayeeCheck | null;
  /** Why the last payment failed. */
  failureReason?: string | null;
  createdAt: string;
  paidAt?: string | null;
  events: BillEvent[];
  editable: boolean;
  deletable: boolean;
  payableByTransfer: boolean;
  payableByCard: boolean;
  /** Its card wasn't used yet, so it can be closed and the bill paid another way. */
  cardCancellable: boolean;
}

export interface BillRequest {
  supplierId: number;
  /** The number of the supplier's invoice. */
  supplierReference?: string | null;
  /** yyyy-MM-dd; today when empty. */
  issueDate?: string | null;
  /** yyyy-MM-dd; the payment terms after the issue date when empty. */
  dueDate?: string | null;
  description?: string | null;
  /** Minor units, excluding tax. */
  subtotal: number;
  vatRate: number;
  /** The expense account; the supplier's default one when empty. */
  category?: string | null;
}

/** What the bill and supplier forms need. */
export interface BillSettings {
  currency: string;
  /** The country of the account. */
  country?: string | null;
  /** VAT, GST or Sales tax. */
  taxLabel: string;
  /** The standard rate first. */
  vatRates: number[];
  defaultVatRate: number;
  paymentTermsDays: number;
  nextNumber: string;
  /** The expense accounts bills are booked to. */
  categories: LedgerAccount[];
  /** The format of the suppliers' bank details; null when the currency of the account has no transfers. */
  bankAccountFormat?: BankAccountFormat | null;
  /** The countries transfers can go to, with a bank account Adyen accepts in TEST. */
  recipientCountries: RecipientCountry[];
  /** Why bills can't be paid by transfer, null when they can. */
  transfersIssue?: string | null;
  /** Why bills can't be paid with a single-use card, null when they can. */
  cardsIssue?: string | null;
  /** The networks a single-use card can be issued on, the default one first. */
  cardBrands: string[];
}

export interface BillPaymentRequest {
  billIds: number[];
  /** regular when empty. */
  transferType?: TransferPriority | null;
}

/** The Verification of Payee of the supplier of a bill, before the bill is paid by transfer. */
export interface PayeeCheck {
  billId: number;
  number: string;
  supplierId: number;
  supplierName: string;
  bankAccount?: string | null;
  result: PayeeCheckResult | string;
  /** The name the supplier's bank has, for a partial match. */
  name?: string | null;
  /** What the result means for the payment. */
  description?: string | null;
  checkedAt?: string | null;
}

/** Whether a bill can be paid at a transfer speed. */
export interface BillTransferSpeed {
  priority: TransferPriority;
  available: boolean;
  /** Why the bill can't be paid at this speed; null when it can. */
  reason?: string | null;
}

/** The transfer speeds that can pay a bill: the routes Adyen offers to the bank of its supplier, within their limits. */
export interface BillTransferRoutes {
  billId: number;
  /** regular, fast and instant, the cheapest first; empty with an error. */
  speeds: BillTransferSpeed[];
  /** Why the routes couldn't be checked; null when they were. */
  error?: string | null;
}

export interface BillPaymentItem {
  billId: number;
  number?: string | null;
  supplierName?: string | null;
  amount: number;
  currency?: string | null;
  /** Null when no transfer was created. */
  transferId?: string | null;
  /** Why no transfer was created. */
  error?: string | null;
}

/** The transfers created for a batch of bills. They wait for one approval, with SCA, on the Batch transfers page. */
export interface BillPaymentResult {
  /** One per bill, in the order of the request. */
  results: BillPaymentItem[];
  created: number;
  failed: number;
}

/** A supplier of the account, with what is still to pay it. */
export interface Supplier {
  id: number;
  name: string;
  email?: string | null;
  country: string;
  vatNumber?: string | null;
  /** Null without bank details: the supplier can only be paid by card. */
  bankAccountFormat?: BankAccountFormat | null;
  iban?: string | null;
  accountNumber?: string | null;
  sortCode?: string | null;
  routingNumber?: string | null;
  /** Only its last digits, e.g. "FR76 •••• 9742". */
  bankAccount?: string | null;
  /** The country of the bank. */
  bankCountry?: string | null;
  defaultCategory?: string | null;
  /** TEST only: null for a regular check. */
  vopScenario?: VopScenario | null;
  createdAt: string;
  billCount: number;
  /** Minor units of its bills that aren't paid yet. */
  outstanding: number;
  currency: string;
}

export interface SupplierRequest {
  /** As it appears on its bank account. */
  name: string;
  email?: string | null;
  country: string;
  vatNumber?: string | null;
  iban?: string | null;
  accountNumber?: string | null;
  sortCode?: string | null;
  routingNumber?: string | null;
  defaultCategory?: string | null;
  vopScenario?: VopScenario | null;
}
