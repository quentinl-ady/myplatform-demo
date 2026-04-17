package com.myplatform.demo.dto;

import lombok.Data;

import java.util.List;

@Data
public class TransactionRuleRequest {
    private String type; // maxTransactions, maxAmountPerTransaction, maxTotalAmount, blockedMccs
    private Long value;
    private String currencyCode;
    private List<String> blockedMccs;
}
