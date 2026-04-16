package com.myplatform.demo.dto;

import lombok.Data;

@Data
public class AddTransactionRuleRequest {
    private String paymentInstrumentId;
    private String type; // maxTransactions, maxAmountPerTransaction, maxTotalAmount
    private Long value;
    private String currencyCode;
}
