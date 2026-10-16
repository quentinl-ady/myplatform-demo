export type CaptureMode = 'IMMEDIATE' | 'DELAYED' | 'MANUAL';
export type CommissionType = 'PERCENTAGE' | 'FIXED';
/** Who pays the payment fees (interchange, scheme fees and Adyen fees). */
export type FeeAllocation = 'PLATFORM' | 'SUB_MERCHANT';
export type SplitMode = 'NONE' | 'STORE_PROFILE' | 'MARKETPLACE_DEFAULT' | 'CUSTOM';

/** Single-seller split: commission for the platform, the rest for the sub-merchant's balance account. */
export interface SplitSettings {
  commissionType: CommissionType;
  /** Percent of the amount, up to 2 decimals (PERCENTAGE). */
  commissionPercentage?: number | null;
  /** Minor units, for the full payment amount (FIXED). */
  commissionAmount?: number | null;
  feeAllocation: FeeAllocation;
}

/** Leave out of the payment request to keep the default behaviour (immediate capture, default split). */
export interface AdvancedPaymentOptions {
  captureMode: CaptureMode;
  /** 1 to 168 hours, for DELAYED. */
  captureDelayHours?: number | null;
  /** Replaces the default split (marketplace commission or store split profile). */
  split?: SplitSettings | null;
}

/** Split instruction sent to Adyen. The amount is empty for the payment fee split. */
export interface SplitLine {
  type: string;
  account?: string | null;
  amount?: number | null;
  reference?: string | null;
}

export type CheckoutPaymentState =
  | 'PENDING_AUTHORISATION'
  | 'AWAITING_CAPTURE'
  | 'CAPTURE_SCHEDULED'
  | 'CAPTURE_SUBMITTED'
  | 'PARTIALLY_CAPTURED'
  | 'CAPTURED'
  | 'AUTO_CAPTURED'
  | 'CANCEL_SUBMITTED'
  | 'CANCELLED'
  | 'NOT_AUTHORISED';

export interface CheckoutPaymentOperation {
  id: number;
  type: 'CAPTURE' | 'CANCEL';
  /** RECEIVED: accepted by Adyen, waiting for the CAPTURE or CANCELLATION webhook. */
  status: 'RECEIVED' | 'SUCCEEDED' | 'FAILED';
  /** ADYEN: only known from a webhook (automatic capture, Customer Area). */
  origin: 'PLATFORM' | 'ADYEN';
  amount?: number | null;
  reference?: string | null;
  pspReference?: string | null;
  reason?: string | null;
  splits: SplitLine[];
  createdAt: string;
  updatedAt?: string | null;
}

/** Checkout payment with delayed or manual capture, listed on the Captures page. Amounts in minor units. */
export interface CheckoutPayment {
  id: string;
  source: 'checkout' | 'issuing-checkout';
  channel: 'DROPIN' | 'SAVED_CARD';
  merchantReference: string;
  pspReference?: string | null;
  storeReference?: string | null;
  balanceAccountId?: string | null;
  amount: number;
  currency: string;
  status: 'CREATED' | 'AUTHORISED' | 'PENDING' | 'REFUSED' | 'NOT_COMPLETED' | 'ERROR';
  state: CheckoutPaymentState;
  refusalReason?: string | null;
  captureMode: CaptureMode;
  captureDelayHours?: number | null;
  scheduledCaptureAt?: string | null;
  capturedAmount: number;
  pendingCaptureAmount: number;
  remainingAmount: number;
  /** Rest of the amount released by Adyen after a partial capture. */
  releasedAmount: number;
  canCapture: boolean;
  canCancel: boolean;
  splitMode: SplitMode;
  splitSettings?: SplitSettings | null;
  splits: SplitLine[];
  createdAt: string;
  authorisedAt?: string | null;
  operations: CheckoutPaymentOperation[];
}

export interface CapturePayload {
  userId: string;
  /** Minor units. Leave empty to capture the whole remaining amount. */
  amount?: number | null;
  /** Split for this capture only. Leave empty to reuse the split of the payment. */
  split?: SplitSettings | null;
}
