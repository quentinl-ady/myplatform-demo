package com.myplatform.demo.dto;

import lombok.Data;

@Data
public class TransactionRuleResponseDTO {
    private String id;
    private String type;
    private Long value;
    private String currencyCode;
    private String status;
}
