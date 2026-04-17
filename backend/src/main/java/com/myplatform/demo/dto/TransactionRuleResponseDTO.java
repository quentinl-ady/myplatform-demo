package com.myplatform.demo.dto;

import lombok.Data;

import java.util.List;

@Data
public class TransactionRuleResponseDTO {
    private String id;
    private String type;
    private Long value;
    private String currencyCode;
    private String status;
    private List<String> blockedMccs;
}
