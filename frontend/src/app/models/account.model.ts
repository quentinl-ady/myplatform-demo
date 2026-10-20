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

/** An account statement that Adyen generated for the business account (CAMT.053), downloaded as a PDF. */
export interface AccountStatement {
  fileName: string;
  currency: string | null;
  /** First and last day covered (yyyy-MM-dd); null when the file name has no period. */
  periodStart: string | null;
  periodEnd: string | null;
  /** When Adyen generated it (ISO-8601 UTC). */
  creationDate: string;
  /** The name to save the PDF under, e.g. account-statement_2026-10-19_EUR.pdf. */
  pdfFileName: string;
}
