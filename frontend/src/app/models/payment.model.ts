export interface SendPaymentPayload {
  amount: number;
  currencyCode: string;
  storeReference: string;
  userId: number;
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
