import { StandingOrderCreateRequest } from './standing-order.model';

export type DeviceKind = 'phone' | 'tablet' | 'computer';

export interface Device {
  id: string;
  name: string;
  paymentInstrumentId: string;
  type: string;
  /** Unknown for the devices registered before the platform recorded it. */
  kind?: DeviceKind | null;
  /** e.g. "iPhone · Safari" */
  platform?: string | null;
  registeredAt?: string | null;
}

export type RemoteSessionType = 'pairing' | 'transfer' | 'standingOrder' | 'batch' | 'transactions';

export type RemoteApprovalType = Exclude<RemoteSessionType, 'pairing'>;

export type RemoteSessionStatus = 'waiting' | 'opened' | 'in_progress' | 'completed' | 'declined' | 'cancelled' | 'expired';

/** A registration or an approval started on this computer and finished on a phone. */
export interface RemoteSession {
  id: string;
  type: RemoteSessionType;
  status: RemoteSessionStatus;
  secondsLeft: number;
  phoneLabel: string | null;
  phonePasskeys: boolean | null;
  /** Last problem on the phone; the user can try again there. */
  message: string | null;
  summary: Record<string, unknown> | null;
  /** What the operation returned once completed. */
  result?: any;
  /** Only when the session is created: the secret of the QR code link. */
  token?: string;
}

export interface RemoteApprovalRequest {
  userId: string;
  type: RemoteApprovalType;
  transfer?: InitiateTransferRequest;
  standingOrder?: StandingOrderCreateRequest;
  transferIds?: string[];
}

/** The session as the phone sees it. */
export interface PhoneSession {
  type: RemoteSessionType;
  status: RemoteSessionStatus;
  secondsLeft: number;
  summary?: Record<string, any> | null;
  accountName?: string | null;
  maskedEmail?: string | null;
  platformName?: string | null;
  logoData?: string | null;
}

export interface PhoneStepResponse {
  /** 'sca_required', 'in_progress' or 'completed'; absent when the step returns what to sign. */
  status?: string;
  sdkInput?: string;
  authParam1?: string;
  associationRequired?: boolean;
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
  userId: string;
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

export interface BatchTransferRequest {
  userId: string;
  amount: number;
  reference: string;
  description: string;
  transferType: string;
  counterpartyCountry: string;
  counterpartyName: string;
  iban: string;
  accountNumber: string;
  routingNumber: string;
  sortCode: string;
}

export interface BatchTransferResponse {
  id: string;
  amount: number;
  currency: string;
  counterpartyName: string;
  status: string;
  reason: string;
  description: string;
  reference: string;
}

export interface BatchApproveResponse {
  status: string;
  authParam1?: string;
  message?: string;
}

export interface BatchCancelResponse {
  status: string;
  transferIds: string[];
}

export interface PendingBatchTransfersResponse {
  transfers?: BatchTransferResponse[];
  notFoundCount?: number;
}

export interface IsCrossBorderRequest {
  userId: string;
  countryCodeCounterparty: string;
}

export type BankAccountFormat = 'iban' | 'accountNumberRoutingNumber' | 'accountNumberSortCode';

export type TestAccount = Partial<Record<'iban' | 'accountNumber' | 'routingNumber' | 'sortCode', string>>;

export interface RecipientCountry {
  countryCode: string;
  currency: string;
  group: string;
  bankAccountFormat: BankAccountFormat;
  payeeVerification: boolean;
  testAccount: TestAccount | null;
}

export type TransferPriority = 'regular' | 'fast' | 'instant';

export interface TransferRouteRequest {
  counterpartyCountry: string;
  iban: string;
  accountNumber: string;
  routingNumber: string;
  sortCode: string;
}

export interface TransferRouteOption {
  priority: TransferPriority;
  minAmount: number | null;
  maxAmount: number | null;
  wholeAmountsOnly: boolean;
  requirements: string[];
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
  /** Tracking events have no booking date, only this one. */
  updateDate: string | null;
  type: string;
  /** Signed: negative when money leaves the account. Null when the event moves no money, like a tracking event. */
  amountValue: number | null;
  amountCurrency: string | null;
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
