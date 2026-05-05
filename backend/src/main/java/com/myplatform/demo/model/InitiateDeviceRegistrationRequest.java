package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class InitiateDeviceRegistrationRequest {
    private String sdkOutput;
    private String userId;
    private String deviceName;
}
