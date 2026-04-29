export interface PayoutAccount {
  transferInstrumentId: string;
  accountIdentifier: string;
}

export interface PayoutConfigurationPayload {
  userId: number;
  balanceAccountId: string;
  currencyCode: string;
  regular: boolean;
  instant: boolean;
  transferInstrumentId: string;
  schedule: string;
}

export interface PayoutConfiguration {
  regular: boolean;
  instant: boolean;
  accountIdentifier: string;
  balanceAccountId: string;
  currencyCode: string;
  schedule: string;
}
