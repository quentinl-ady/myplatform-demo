package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TokenPaymentRequest {
    private Long amount;
    private String currencyCode;
    private String storeReference;
    private String userId;
    private String reference;
    private String storedPaymentMethodId;
    private String type;
    /** Issuing tests: platform user whose Captures page lists the payment. */
    private String returnUserId;
    private AdvancedPaymentOptions advancedOptions;
}
