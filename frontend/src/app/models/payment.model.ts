export interface SendPaymentPayload {
  amount: number;
  currencyCode: string;
  storeReference: string;
  userId: string;
  reference: string;
}

export interface SendPaymentResponse {
  id: string;
  sessionData: string;
  amount: number;
  currency: string;
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
}

export interface TokenPaymentResponse {
  pspReference: string;
  resultCode: string;
  refusalReason: string;
}
