package com.myplatform.demo.dto;

import com.myplatform.demo.model.CounterpartyVerificationResponse;
import lombok.Data;

@Data
public class AdyenVerifyResponseWrapper {
    private CounterpartyVerificationResponse counterpartyVerification;
}
