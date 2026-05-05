package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class IsCrossBorderRequest {
    private String userId;
    private String countryCodeCounterparty;
}
