package com.myplatform.demo.dto;

import lombok.Data;

@Data
public class RevealCardRequest {
    private String paymentInstrumentId;
    private String encryptedKey;
}
