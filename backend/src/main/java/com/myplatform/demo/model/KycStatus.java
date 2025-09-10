package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class KycStatus {
    private Status acquiringStatus;
    private Status payoutStatus;
}

