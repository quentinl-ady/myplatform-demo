package com.myplatform.demo.dto;

import lombok.Data;

import java.util.List;

@Data
public class CardResponse {
    private String paymentInstrumentId;
    private String cardholderName;
    private String brand;
    private String brandVariant;
    private String lastFour;
    private String expiryMonth;
    private String expiryYear;
    private String status;
    private List<TransactionRuleResponseDTO> transactionRules;
}
