package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DeleteDeviceRequest {
    private String id;
    private String paymentInstrumentId;
}
