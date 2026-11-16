/** OVERDUE is a sent invoice past its due date. */
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'OVERDUE' | 'PAID' | 'VOID';

/** As Adyen last reported it. */
export type PaymentLinkStatus = 'active' | 'paymentPending' | 'completed' | 'paid' | 'expired';

export type InvoiceEventType =
  | 'CREATED'
  | 'UPDATED'
  | 'SENT'
  | 'LINK_RENEWED'
  | 'LINK_EXPIRED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_REFUSED'
  | 'PAID'
  | 'VOIDED'
  | 'CHARGE_SUBMITTED'
  | 'REFUNDED';

/** The customer as the invoice shows it. */
export interface InvoiceCustomer {
  id: number;
  displayName: string;
  name: string;
  company?: string | null;
  email: string;
  country?: string | null;
  vatNumber?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

/** Amounts in minor units. */
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Percent, e.g. 20 or 5.5. */
  vatRate: number;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
}

/** The tax of one rate. */
export interface InvoiceVat {
  rate: number;
  base: number;
  tax: number;
}

export interface InvoicePaymentLink {
  id: string;
  url: string;
  status: PaymentLinkStatus | string;
  expiresAt?: string | null;
  /** When the backend last asked Adyen for its status. */
  checkedAt?: string | null;
}

export interface InvoiceEvent {
  type: InvoiceEventType;
  occurredAt: string;
  detail?: string | null;
  pspReference?: string | null;
}

/** PENDING until Adyen confirms the charge. RESCUING: refused, and Adyen Auto Rescue retries it. */
export type InvoiceChargeStatus = 'PENDING' | 'REFUSED' | 'RESCUING' | 'AUTHORISED';

/** The last charge of a subscription invoice to the payment method the customer stored. */
export interface InvoiceCharge {
  status: InvoiceChargeStatus;
  refusalReason?: string | null;
  /** The charges Adyen answered. */
  attempts: number;
  chargedAt?: string | null;
}

/** REQUESTED until the refund is confirmed. */
export type InvoiceRefundStatus = 'REQUESTED' | 'REFUNDED' | 'FAILED';

/** The last refund of the payment of an invoice. */
export interface InvoiceRefund {
  status: InvoiceRefundStatus;
  requestedAt?: string | null;
  refundedAt?: string | null;
  failureReason?: string | null;
  /** The terminal it was requested at, null when it was made otherwise. */
  terminalId?: string | null;
  pspReference?: string | null;
}

/** A customer invoice, paid with an Adyen payment link. Amounts in minor units. */
export interface Invoice {
  id: number;
  number: string;
  status: InvoiceStatus;
  daysOverdue?: number | null;
  customer: InvoiceCustomer;
  /** yyyy-MM-dd */
  issueDate: string;
  /** yyyy-MM-dd */
  dueDate: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  /** What the customer still has to pay: the total of a draft or sent invoice, 0 otherwise. */
  amountDue: number;
  lines: InvoiceLine[];
  vat: InvoiceVat[];
  notes?: string | null;
  paymentLink?: InvoicePaymentLink | null;
  pspReference?: string | null;
  /** As Adyen reports it, e.g. "mc". */
  paymentMethod?: string | null;
  /** e.g. "Mastercard" */
  paymentMethodName?: string | null;
  storeReference?: string | null;
  createdAt: string;
  sentAt?: string | null;
  paidAt?: string | null;
  voidedAt?: string | null;
  /** The subscription whose billing cycle the invoice bills, null for a one-off invoice. */
  subscriptionId?: number | null;
  /** The billing cycle, from 1. */
  subscriptionCycle?: number | null;
  /** The last charge to the payment method the subscription stored, null until there is one. */
  charge?: InvoiceCharge | null;
  events: InvoiceEvent[];
  editable: boolean;
  /** A payment link can be created: the invoice is a draft, or its link expired. */
  sendable: boolean;
  voidable: boolean;
  /** The terminal the invoice was paid at, null when it was paid otherwise. */
  terminalId?: string | null;
  /** Can be paid at a terminal: sent, and no other payment of it is in progress. */
  terminalPayable: boolean;
  /** The payment can be refunded at a terminal: what it hasn't given back yet. */
  refundable: boolean;
  /** What the confirmed refunds gave back. */
  refundedAmount: number;
  /** The last refund, null until there is one. */
  refund?: InvoiceRefund | null;
}

/** A terminal boarded in a store of the account: it can collect and refund the payments of invoices. */
export interface InvoiceTerminal {
  id: string;
  model?: string | null;
  storeId: string;
  storeReference?: string | null;
  storeCity?: string | null;
}

/**
 * How a terminal answered. A payment: APPROVED, DECLINED, CANCELLED, ERROR (nothing was charged) or UNKNOWN (the answer
 * was lost: the card may have been charged). A refund: REQUESTED (confirmed later), DECLINED, ERROR or UNKNOWN.
 */
export type TerminalOutcome = 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ERROR' | 'UNKNOWN' | 'REQUESTED';

export interface TerminalResult {
  outcome: TerminalOutcome;
  /** Why it didn't succeed, or what to do next. */
  message?: string | null;
  /** e.g. "visa" */
  cardBrand?: string | null;
  /** e.g. "411111******1111" */
  maskedPan?: string | null;
  pspReference?: string | null;
  /** The invoice once the answer is applied. */
  invoice: Invoice;
}

export interface InvoiceLineRequest {
  description: string;
  quantity: number;
  /** Minor units, excluding tax. */
  unitPrice: number;
  vatRate: number;
}

export interface InvoiceRequest {
  customerId: number;
  /** yyyy-MM-dd; today when empty. */
  issueDate?: string | null;
  /** yyyy-MM-dd; the payment terms after the issue date when empty. */
  dueDate?: string | null;
  notes?: string | null;
  lines: InvoiceLineRequest[];
}

/** What the invoice form needs. */
export interface InvoiceSettings {
  currency: string;
  /** The country of the account, which new customers default to. */
  country?: string | null;
  /** VAT, GST or Sales tax. */
  taxLabel: string;
  /** The standard rate first. */
  vatRates: number[];
  defaultVatRate: number;
  paymentTermsDays: number;
  nextNumber: string;
  paymentLinksReady: boolean;
  /** Why invoices can't be sent yet. */
  paymentLinksIssue?: string | null;
  /** The account has a store, whose terminals can collect and refund the payments of invoices. */
  terminalsAvailable: boolean;
}

/** A customer of the account, with what it owes. */
export interface Customer {
  id: number;
  name: string;
  company?: string | null;
  /** The company, else the name. */
  displayName: string;
  email: string;
  country?: string | null;
  vatNumber?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
  /** Identifies the customer at Adyen, e.g. for its stored payment methods. */
  shopperReference: string;
  createdAt: string;
  invoiceCount: number;
  /** Minor units still to be paid on sent invoices. */
  outstanding: number;
  currency: string;
}

export interface CustomerRequest {
  name: string;
  company?: string | null;
  email: string;
  country: string;
  vatNumber?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

/** What loading the demo data created. What already exists isn't created again. */
export interface DemoDataResult {
  customersCreated: number;
  invoicesCreated: number;
  paymentLinksCreated: number;
  subscriptionsCreated: number;
  suppliersCreated: number;
  billsCreated: number;
  warnings: string[];
}
