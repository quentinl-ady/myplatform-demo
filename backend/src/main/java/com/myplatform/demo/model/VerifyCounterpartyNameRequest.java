package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class VerifyCounterpartyNameRequest {
    String accountHolderName; //Quentin
    String iban;
    String reference;
    String accountNumber;
    String sortCode;
    String accountType; //iban accountNumberSortCode
    String transferType; //regular //instant
    String counterpartyCountry; //FR //EN GB //DE etc...
}
