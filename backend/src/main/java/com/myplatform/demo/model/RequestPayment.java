package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RequestPayment {
    Long amount;
    String currencyCode;
    String storeReference;
    String userId;
    String reference;
}
