package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class InitiateTransferResponse {
    String authParam1;
    Long amount;
    String counterpartyCountry;
    String accountNumber;
    String sortCode;
    String iban;
    String routingNumber;
}
