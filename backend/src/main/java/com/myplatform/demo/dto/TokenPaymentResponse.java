package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TokenPaymentResponse {
    private String pspReference;
    private String resultCode;
    private String refusalReason;
}
