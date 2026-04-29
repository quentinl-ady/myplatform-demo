export interface TransactionRuleRequest {
  type: string;
  value?: number;
  currencyCode?: string;
  blockedMccs?: string[];
}

export interface CreateCardRequest {
  userId: number;
  cardholderName: string;
  brand: string;
  email?: string;
  phone?: string;
  transactionRules?: TransactionRuleRequest[];
}

export interface PhonePrefix {
  code: string;
  country: string;
  flag: string;
}

export interface TransactionRuleResponse {
  id: string;
  type: string;
  value?: number;
  currencyCode?: string;
  status: string;
  blockedMccs?: string[];
}

export interface CardResponse {
  paymentInstrumentId: string;
  cardholderName: string;
  brand: string;
  brandVariant: string;
  lastFour: string;
  expiryMonth: string;
  expiryYear: string;
  status: string;
  transactionRules: TransactionRuleResponse[];
}

export interface AddTransactionRuleRequest {
  paymentInstrumentId: string;
  type: string;
  value?: number;
  currencyCode?: string;
  blockedMccs?: string[];
}

export interface CardTransferValidationFact {
  type: string;
  result: string;
}

export interface CardTransferEvent {
  id: string;
  status: string;
  bookingDate: string;
  type: string;
  amountValue: number;
  amountCurrency: string;
  originalAmountValue: number;
  originalAmountCurrency: string;
}

export interface CardTransferTriggeredRule {
  reason: string;
  ruleDescription: string;
  ruleId: string;
  outcomeType: string;
}

export interface CardTransferRulesResult {
  advice: string;
  allHardBlockRulesPassed: boolean;
  score: number;
  triggeredRules: CardTransferTriggeredRule[];
}

export interface CardTransfer {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  type: string;
  reason: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  sequenceNumber: number;
  paymentInstrumentId: string;
  paymentInstrumentDescription: string;
  processingType: string;
  panEntryMode: string;
  authorisationType: string;
  threeDSecureAcsTransactionId: string;
  merchantName: string;
  merchantCity: string;
  merchantCountry: string;
  mcc: string;
  validationFacts: CardTransferValidationFact[];
  events: CardTransferEvent[];
  transactionRulesResult: CardTransferRulesResult;
}
