package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BankAccountInformationResponse {
    private String currency;
    private Long amount;
    private String bankAccountNumber;
    private String description;
}
