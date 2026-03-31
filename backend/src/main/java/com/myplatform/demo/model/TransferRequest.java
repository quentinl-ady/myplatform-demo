package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TransferRequest {
    String sdkOutput;
    Long amount;
    String counterpartyBankAccount;
    String reference;
    Long userId;
    String transferType;
}
