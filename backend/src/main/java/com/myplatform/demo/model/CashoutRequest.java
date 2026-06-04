package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class CashoutRequest {
    private String userId;
    private String balanceAccountId;
    private String currency;
    private long amount;
    private String transferInstrumentId;
    private String description;
}
