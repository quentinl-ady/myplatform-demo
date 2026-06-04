export interface User {
  id: string;
  email: string;
  legalEntityName: string;
  countryCode: string;
  userType: string;
  legalEntityId: string;
  firstName: string | null;
  lastName: string | null;
  accountHolderId: string;
  currencyCode: string;
  balanceAccountId: string;
  activityReason: string;
  bank: boolean;
  capital: boolean;
  issuing: boolean;
  bankAccountId: string;
  bankAccountNumber: string;
}

export interface BalanceAccount {
  currencyCode: string;
  description: string;
  balanceAccountId: string;
  status?: string;
  balances?: BalanceInfo[];
  sweeps?: SweepInfo[];
}

export interface BalanceInfo {
  currency: string;
  available: number;
  balance: number;
  pending: number;
  reserved: number;
}

export interface SweepInfo {
  id: string;
  currency: string;
  category: string;
  description: string;
  scheduleType: string;
  cronExpression: string;
  type: string;
  status: string;
  counterpartyTransferInstrumentId: string;
  counterpartyBalanceAccountId: string;
  priorities: string[];
}

export interface InternalTransferRequest {
  userId: string;
  sourceBalanceAccountId: string;
  destinationBalanceAccountId: string;
  currency: string;
  amount: number;
  description?: string;
}

export interface CashoutRequest {
  userId: string;
  balanceAccountId: string;
  currency: string;
  amount: number;
  transferInstrumentId: string;
  description?: string;
}

export interface BankAccountStatus {
  bankingEnabled: boolean;
  bankAccountCreated: boolean;
  bankingAllowed: boolean;
  bankAccountId: string | null;
  bankAccountNumber: string | null;
}

export interface BankAccountInformationResponse {
  currency: string;
  amount: number;
  bankAccountNumber: string;
  description: string;
}
