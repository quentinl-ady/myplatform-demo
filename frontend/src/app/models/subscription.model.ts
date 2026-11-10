import { InvoiceChargeStatus, InvoiceStatus } from './invoice.model';

/** Awaiting the payment method until the customer pays the first invoice, which stores it. */
export type SubscriptionStatus = 'AWAITING_PAYMENT_METHOD' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export type SubscriptionFrequency = 'MONTHLY' | 'YEARLY';

export type SubscriptionEventType =
  | 'CREATED'
  | 'UPDATED'
  | 'CYCLE_BILLED'
  | 'INVOICE_SENT'
  | 'PAID'
  | 'PAYMENT_METHOD_STORED'
  | 'ACTIVATED'
  | 'CHARGED'
  | 'CHARGE_PENDING'
  | 'CHARGE_REFUSED'
  | 'CHARGE_FAILED'
  | 'RESCUE_STOPPED'
  | 'RESCUE_ENDED'
  | 'PAST_DUE'
  | 'REACTIVATED'
  | 'CANCELLED';

/** TEST only: how the charge of a billing cycle ends. The last four play an Auto Rescue scenario. */
export type SubscriptionTestOutcome =
  | 'REFUSED'
  | 'EXPIRED_CARD'
  | 'NOT_ENOUGH_BALANCE'
  | 'RESCUED_FIRST_RETRY'
  | 'RESCUED_SECOND_RETRY'
  | 'NOT_RESCUED'
  | 'FRAUD';

export interface SubscriptionCustomer {
  id: number;
  displayName: string;
  email: string;
}

/** The payment method the customer stored by paying an invoice of the subscription. */
export interface SubscriptionPaymentMethod {
  /** As Adyen names it, e.g. mc or sepadirectdebit. */
  variant?: string | null;
  /** e.g. "Mastercard" */
  name: string;
  /** e.g. "Mastercard •••• 1111" */
  label: string;
  /** Of the card or of the IBAN. */
  lastDigits?: string | null;
  /** MM/YYYY, for a card. */
  expiry?: string | null;
  holder?: string | null;
  storedAt?: string | null;
  card: boolean;
}

/** The invoice of a billing cycle. Amounts in minor units. */
export interface SubscriptionInvoice {
  id: number;
  number: string;
  cycle: number;
  /** yyyy-MM-dd */
  periodStart: string;
  /** yyyy-MM-dd */
  periodEnd: string;
  status: InvoiceStatus;
  total: number;
  /** yyyy-MM-dd */
  dueDate: string;
  /** Null until the invoice is charged to the stored payment method. */
  chargeStatus?: InvoiceChargeStatus | null;
  chargeRefusalReason?: string | null;
  paidAt?: string | null;
  /** The link the customer can still pay with. */
  paymentLinkUrl?: string | null;
  /** A payment link can be sent for the invoice. */
  sendable: boolean;
}

export interface SubscriptionEvent {
  type: SubscriptionEventType;
  occurredAt: string;
  detail?: string | null;
  invoiceNumber?: string | null;
}

/** A plan a customer pays every month or every year, with an invoice per billing cycle. Amounts in minor units. */
export interface CustomerSubscription {
  id: number;
  status: SubscriptionStatus;
  customer: SubscriptionCustomer;
  plan: string;
  frequency: SubscriptionFrequency;
  /** Per cycle, excluding tax. */
  price: number;
  /** Percent, e.g. 20 or 5.5. */
  vatRate: number;
  /** Per cycle, including tax. */
  total: number;
  currency: string;
  /** yyyy-MM-dd */
  startDate: string;
  /** yyyy-MM-dd: the first day of the next cycle to bill. */
  nextBillingDate: string;
  cyclesBilled: number;
  /** Null until the customer pays the first invoice. */
  paymentMethod?: SubscriptionPaymentMethod | null;
  /** Adyen Auto Rescue retries the refused card charges. */
  autoRescue: boolean;
  rescueDays?: number | null;
  createdAt: string;
  activatedAt?: string | null;
  pastDueSince?: string | null;
  cancelledAt?: string | null;
  /** The latest cycle first. */
  invoices: SubscriptionInvoice[];
  events: SubscriptionEvent[];
  /** Why the next cycle can't be billed now, null when it can. */
  runCycleBlocked?: string | null;
  /** Running the cycle charges this invoice again, instead of billing a new cycle. */
  retryInvoiceNumber?: string | null;
  rescueStoppable: boolean;
  cancellable: boolean;
  /** The payment method is a card, so TEST refusals can be simulated. */
  cardOutcomes: boolean;
  /** What went wrong while creating the subscription, e.g. its first payment link. */
  warning?: string | null;
}

export interface SubscriptionRequest {
  customerId: number;
  plan: string;
  /** Minor units per cycle, excluding tax. */
  price: number;
  vatRate: number;
  frequency: SubscriptionFrequency;
  /** yyyy-MM-dd; today when empty. */
  startDate?: string | null;
  autoRescue?: boolean;
  /** 30 days when empty. */
  rescueDays?: number | null;
}

/** What the subscription form needs. */
export interface SubscriptionSettings {
  currency: string;
  /** The country of the account, which new customers default to. */
  country?: string | null;
  /** VAT, GST or Sales tax. */
  taxLabel: string;
  /** The standard rate first. */
  vatRates: number[];
  defaultVatRate: number;
  /** Adyen enabled Auto Rescue on the merchant account. */
  autoRescueAvailable: boolean;
  defaultRescueDays: number;
  maxRescueDays: number;
  /** Why subscriptions can't start yet. */
  issue?: string | null;
}
