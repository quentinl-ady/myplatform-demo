import { AdvancedPaymentOptions } from './capture.model';

export interface SendPaymentPayload {
  amount: number;
  currencyCode: string;
  storeReference: string;
  userId: string;
  reference: string;
  /** Platform user the result page links back to when the payment uses a redirect. */
  returnUserId?: string;
  advancedOptions?: AdvancedPaymentOptions;
}

export interface SendPaymentResponse {
  id: string;
  sessionData: string;
  amount: number;
  currency: string;
  /** Id of the payment on the Captures page; null for immediate capture. */
  trackingId?: string | null;
}

export interface PosPaymentRequest {
  reference: string;
  amount: number;
  currency: string;
  terminalId: string;
}

export interface PosPaymentResponse {
  status: string;
  pspReference: string;
  cardBrand: string;
  maskedPan: string;
  errorCondition: string;
  refusalReason: string;
  reference: string;
}

export interface StoredPaymentMethod {
  recurringDetailReference: string;
  type: string;
  cardBrand: string;
  cardSummary: string;
  expiryMonth: string;
  expiryYear: string;
  holderName: string;
}

export interface TokenPaymentPayload {
  amount: number;
  currencyCode: string;
  storeReference: string;
  userId: string;
  reference: string;
  storedPaymentMethodId: string;
  type: string;
  /** Issuing tests: platform user whose Captures page lists the payment. */
  returnUserId?: string;
  advancedOptions?: AdvancedPaymentOptions;
}

export interface TokenPaymentResponse {
  pspReference: string;
  resultCode: string;
  refusalReason: string;
  /** Id of the payment on the Captures page; null for immediate capture. */
  trackingId?: string | null;
}

export interface GooglePayJwtResponse {
  googlePayJwtToken: string;
  /** Google merchant ID. */
  merchantId?: string;
  /** Adyen merchant account used as the Google Pay gateway merchant. */
  gatewayMerchantId?: string;
  merchantName?: string;
}
