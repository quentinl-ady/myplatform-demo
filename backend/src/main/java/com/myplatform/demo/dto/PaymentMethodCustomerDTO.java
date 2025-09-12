package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PaymentMethodCustomerDTO {
    private String type;
    private String verificationStatus;
}
