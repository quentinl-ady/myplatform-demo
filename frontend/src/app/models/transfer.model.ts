export interface Device {
  id: string;
  name: string;
  paymentInstrumentId: string;
  type: string;
}

export interface RegisterSCAResponse {
  id: string;
  paymentInstrumentId: string;
  sdkInput: string;
  success: boolean;
}

export interface RegisterSCAFinalResponse {
  success: boolean;
}

export interface DeleteDeviceRequest {
  id: string;
  paymentInstrumentId: string;
}

export interface InitiateTransferRequest {
  sdkOutput: string;
  amount: number;
  reference: string;
  description: string;
  userId: number;
  transferType: string;
  counterpartyCountry: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
  counterpartyName: string;
}

export interface InitiateTransferResponse {
  authParam1: string;
  amount: number;
  counterpartyCountry: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
}

export interface IsCrossBorderRequest {
  userId: number;
  countryCodeCounterparty: string;
}

export interface IsBankAccountValidRequest {
  transferType: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
  bankAccountFormat: string;
}

export interface VerifyCounterpartyNameRequest {
  accountHolderName: string;
  iban: string;
  reference: string;
  accountNumber: string;
  sortCode: string;
  accountType: string;
  transferType: string;
  counterpartyCountry: string;
}

export interface CounterpartyVerificationResponse {
  name: string;
  response: string;
  responseDescription: string;
}

export interface BankTransaction {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  creationDate: string;
  bookingDate: string;
  valueDate: string;
  referenceForBeneficiary: string;
  accountHolderId: string;
  accountHolderDescription: string;
  balanceAccountId: string;
  balanceAccountDescription: string;
  paymentInstrumentId: string;
  paymentInstrumentDescription: string;
  transferId: string;
  transferReference: string;
}

export interface TransferEvent {
  id: string;
  status: string;
  bookingDate: string;
  type: string;
  amountValue: number;
  amountCurrency: string;
  originalAmountValue: number;
  originalAmountCurrency: string;
}

export interface TransferDetail {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  type: string;
  reason: string;
  reference: string;
  category: string;
  direction: string;
  createdAt: string;
  updatedAt: string;
  sequenceNumber: number;
  paymentInstrumentId: string;
  paymentInstrumentDescription: string;
  counterpartyName: string;
  counterpartyIban: string;
  counterpartyAccountNumber: string;
  counterpartySortCode: string;
  counterpartyRoutingNumber: string;
  counterpartyBankName: string;
  counterpartyCountry: string;
  counterpartyAccountIdentificationType: string;
  priority: string;
  paymentType: string;
  events: TransferEvent[];
}
