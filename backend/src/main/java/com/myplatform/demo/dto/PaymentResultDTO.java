package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PaymentResultDTO {
    private String resultCode;
    private String pspReference;
}
