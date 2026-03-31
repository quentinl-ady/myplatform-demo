package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FinalizeRegistrationRequest {
    private String id;
    private String sdkOutput;
    private Long userId;
}
