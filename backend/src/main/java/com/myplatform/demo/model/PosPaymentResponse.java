package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PosPaymentResponse {
    private String status;
    private String pspReference;
    private String cardBrand;
    private String maskedPan;
    private String errorCondition;
    private String refusalReason;
    private String reference;
}
