package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class CardTransferDTO {
    private String id;
    private String status;
    private long amount;
    private String currency;
    private String description;
    private String type;
    private String reason;
    private String reference;
    private String createdAt;
    private String updatedAt;
    private int sequenceNumber;

    // Payment instrument
    private String paymentInstrumentId;
    private String paymentInstrumentDescription;

    // Category data
    private String processingType;
    private String panEntryMode;
    private String authorisationType;

    // 3D Secure
    private String threeDSecureAcsTransactionId;

    // Merchant
    private String merchantName;
    private String merchantCity;
    private String merchantCountry;
    private String mcc;

    // Validation facts
    private List<ValidationFact> validationFacts;

    // Events (lifecycle)
    private List<TransferEvent> events;

    // Transaction rules result
    private TransactionRulesResultDTO transactionRulesResult;

    @Getter
    @Setter
    public static class ValidationFact {
        private String type;
        private String result;

        public ValidationFact() {}

        public ValidationFact(String type, String result) {
            this.type = type;
            this.result = result;
        }
    }

    @Getter
    @Setter
    public static class TransferEvent {
        private String id;
        private String status;
        private String bookingDate;
        private String type;
        private long amountValue;
        private String amountCurrency;
        private long originalAmountValue;
        private String originalAmountCurrency;
    }

    @Getter
    @Setter
    public static class TransactionRulesResultDTO {
        private String advice;
        private boolean allHardBlockRulesPassed;
        private int score;
        private List<TriggeredRule> triggeredRules;
    }

    @Getter
    @Setter
    public static class TriggeredRule {
        private String reason;
        private String ruleDescription;
        private String ruleId;
        private String outcomeType;
    }
}
