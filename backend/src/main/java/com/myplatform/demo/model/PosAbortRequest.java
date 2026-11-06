package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PosAbortRequest {
    String terminalId;
    /** Nexo ServiceID of the payment request to cancel. */
    String serviceId;
}
