package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PaymentSessionResponse {
    String id;
    String sessionData;
    Long amount;
    String currency;
}
