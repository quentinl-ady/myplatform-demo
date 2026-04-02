package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PosPaymentRequest {
    String reference;
    Long amount;
    String currency;
    String terminalId;
}
