package com.myplatform.demo.dto;

import lombok.Data;

import java.util.List;

@Data
public class CreateCardRequest {
    private Long userId;
    private String cardholderName;
    private String brand; // visa or mc
    private List<TransactionRuleRequest> transactionRules;
}
