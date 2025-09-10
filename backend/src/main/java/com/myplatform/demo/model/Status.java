package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class Status {
    private Boolean allowed;
    private String verificationStatus; //pending valid invalid rejected

}
