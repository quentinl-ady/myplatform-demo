package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BusinessBankAccountRequest {
    private String country; //FR //NL
    private String reference;
    private Activity activity;
    private Long userId;
}
