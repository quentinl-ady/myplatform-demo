package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class InitiateDeviceRegistrationRequest {
    private String sdkOutput;
    private Long userId;
}
