import {BalanceAccount} from './account.model';
import {VerificationStatus} from './onboarding.model';

export interface StorePayload {
  businessLineId: string[];
  city: string;
  country: string;
  postalCode: string;
  lineAdresse1: string;
  reference: string;
  phoneNumber: string;
  balanceAccountId: string;
  paymentMethodRequest: string[];
}

export interface Store {
  storeId: string;
  storeRef: string;
  city: string;
  country: string;
  lineAdresse: string;
  phoneNumber: string;
  balanceAccountInfoCustomer: BalanceAccount;
  paymentMethods: { type: string; verificationStatus: VerificationStatus }[];
}

export interface TerminalResponse {
  id: string;
  status: string;
  model: string;
}
