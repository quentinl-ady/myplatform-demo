package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TransferRequest {
    String sdkOutput;
    Long amount;
    String reference;
    String description;
    Long userId;
    String transferType;
    String counterpartyCountry;
    String accountNumber;
    String sortCode;
    String iban;
    String routingNumber;
    String counterpartyName;
}
