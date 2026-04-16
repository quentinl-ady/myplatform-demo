package com.myplatform.demo.dto;

import lombok.Data;

@Data
public class UpdateCardStatusRequest {
    private String paymentInstrumentId;
    private String status; // active, suspended, closed
}
