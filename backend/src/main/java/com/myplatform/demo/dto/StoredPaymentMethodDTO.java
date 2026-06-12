package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class StoredPaymentMethodDTO {
    private String recurringDetailReference;
    private String cardBrand;
    private String cardSummary;
    private String expiryMonth;
    private String expiryYear;
    private String holderName;
}
