package com.myplatform.demo.model;


import com.myplatform.demo.dto.AdvancedPaymentOptions;
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
    /** Platform user to send back to after a redirect payment, when it differs from userId (issuing tests). */
    String returnUserId;
    /** Split, fee allocation and capture settings. Ignored by tokenization sessions. */
    AdvancedPaymentOptions advancedOptions;
}
