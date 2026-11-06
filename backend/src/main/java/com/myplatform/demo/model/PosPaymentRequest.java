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
    /** Optional Nexo ServiceID chosen by the client so it can abort this payment later (1-10 alphanumeric characters). */
    String serviceId;
}
