package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class IsCrossBorderRequest {
    private Long userId;
    private String countryCodeCounterparty;
}
