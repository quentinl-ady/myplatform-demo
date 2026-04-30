export interface StandingOrderAmount {
  currency: string;
  value: number;
}

export interface StandingOrderCounterparty {
  bankAccount: {
    accountHolder: {
      fullName: string;
    };
    accountIdentification: {
      type: string;
      iban: string;
    };
  };
}

export interface StandingOrder {
  id: string;
  balanceAccountId: string;
  amount: StandingOrderAmount;
  counterparty: StandingOrderCounterparty;
  schedule: 'daily' | 'weekdays' | 'weekly' | 'monthly';
  priorities: string[];
  reference: string;
  description: string;
  referenceForBeneficiary: string;
  status: 'active' | 'inactive';
}

export interface StandingOrderListResponse {
  standingOrders: StandingOrder[];
}

export interface StandingOrderCreateRequest {
  amount: StandingOrderAmount;
  counterparty: StandingOrderCounterparty;
  schedule: string;
  priorities: string[];
  reference: string;
  description: string;
  referenceForBeneficiary: string;
}

export interface StandingOrderInitiateResponse {
  status: 'completed' | 'sca_required';
  standingOrder?: StandingOrder;
  standingOrderId?: string;
  authParam1?: string;
  responseBody?: string;
}
