package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RequestCardData {
    String encryptedKey;
    String paymentInstrumentId;
    String reason;
}
