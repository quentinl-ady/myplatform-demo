package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class InternalTransferRequest {
    private String userId;
    private String sourceBalanceAccountId;
    private String destinationBalanceAccountId;
    private String currency;
    private long amount;
    private String description;
}
