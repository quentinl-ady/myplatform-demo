package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FinalizeRegistrationRequest {
    private String id;
    private String sdkOutput;
    private String userId;
    /** phone, tablet or computer: what the device registering itself runs on */
    private String kind;
    /** e.g. "Mac · Chrome" */
    private String platform;
}
