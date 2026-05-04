package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class BankTransferDTO {
    private String id;
    private String status;
    private long amount;
    private String currency;
    private String description;
    private String type;
    private String reason;
    private String reference;
    private String category;
    private String direction;
    private String createdAt;
    private String updatedAt;
    private int sequenceNumber;

    // Payment instrument
    private String paymentInstrumentId;
    private String paymentInstrumentDescription;

    // Counterparty
    private String counterpartyName;
    private String counterpartyIban;
    private String counterpartyAccountNumber;
    private String counterpartySortCode;
    private String counterpartyRoutingNumber;
    private String counterpartyBankName;
    private String counterpartyCountry;
    private String counterpartyAccountIdentificationType;

    // Category data (bank-specific)
    private String priority;
    private String paymentType;

    // Events (lifecycle)
    private List<TransferEvent> events;

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
}
