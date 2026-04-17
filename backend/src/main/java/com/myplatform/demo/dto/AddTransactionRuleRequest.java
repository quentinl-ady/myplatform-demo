package com.myplatform.demo.dto;

import lombok.Data;

import java.util.List;

@Data
public class AddTransactionRuleRequest {
    private String paymentInstrumentId;
    private String type; // maxTransactions, maxAmountPerTransaction, maxTotalAmount, blockedMccs
    private Long value;
    private String currencyCode;
    private List<String> blockedMccs;
}
