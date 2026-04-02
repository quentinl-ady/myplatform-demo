package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class IsBankAccountValidRequest {
    String transferType;
    String accountNumber;
    String sortCode;
    String iban;
    String routingNumber;
    String bankAccountFormat;
}
