export interface TopUpCapability {
  requested: boolean | null;
  allowed: boolean | null;
  /** A capability can be used only when it is both allowed and enabled. */
  enabled: boolean | null;
  verificationStatus: string | null;
}

export type TopUpSchedule = 'weekly' | 'monthly';

export interface TopUpSweep {
  id: string;
  status: string | null;
  schedule: string | null;
  amount: number | null;
  currency: string;
  transferInstrumentId: string | null;
  /** Null when the collection happens regardless of the balance. */
  minimumBalance: number | null;
}

export interface TopUpBankAccount {
  transferInstrumentId: string;
  /** IBAN or local account number, masked when the details could not be read. */
  accountNumber: string;
  bankName: string | null;
  countryCode: string | null;
  status: 'verified' | 'pending' | 'actionRequired' | 'unknown';
}

export interface TopUpContext {
  businessAccountExists: boolean;
  balanceAccountId: string | null;
  currency: string;
  paymentMethod: string | null;
  mandateKind: 'SEPA' | 'BACS' | 'ACH' | 'none';
  capabilities: Partial<Record<string, TopUpCapability>>;
  sweeps: TopUpSweep[];
  messages: string[];
}

export interface TopUpResult {
  pspReference: string | null;
  resultCode: string | null;
  refusalReason: string | null;
  amount: number;
  currency: string;
}

export interface TopUpSweepRequest {
  transferInstrumentId: string;
  amount: number;
  schedule: TopUpSchedule;
}
