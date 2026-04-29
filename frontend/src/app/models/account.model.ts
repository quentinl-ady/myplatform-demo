export interface User {
  id: number;
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
