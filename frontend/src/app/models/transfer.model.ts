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
  userId: number;
  transferType: string;
  counterpartyCountry: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  routingNumber: string;
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
