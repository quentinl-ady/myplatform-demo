package com.myplatform.demo.dto;

import lombok.Data;

@Data
public class TransactionRuleRequest {
    private String type; // maxTransactions, maxAmountPerTransaction, maxTotalAmount
    private Long value;
    private String currencyCode;
}
