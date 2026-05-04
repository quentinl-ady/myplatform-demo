package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TransactionDTO {
    private String id;
    private String status;
    private long amount;
    private String currency;
    private String description;
    private String creationDate;
    private String bookingDate;
    private String valueDate;
    private String referenceForBeneficiary;

    // Account holder
    private String accountHolderId;
    private String accountHolderDescription;

    // Balance account
    private String balanceAccountId;
    private String balanceAccountDescription;

    // Payment instrument
    private String paymentInstrumentId;
    private String paymentInstrumentDescription;

    // Transfer info
    private String transferId;
    private String transferReference;
}
