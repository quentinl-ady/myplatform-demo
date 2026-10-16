package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

/** sessionResult returned by the Drop-in in onPaymentCompleted / onPaymentFailed. */
@Getter
@Setter
public class SessionResultRequest {
    private String userId;
    private String sessionResult;
}
