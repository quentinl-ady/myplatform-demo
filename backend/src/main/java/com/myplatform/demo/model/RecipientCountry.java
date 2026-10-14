package com.myplatform.demo.model;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Map;

@Getter
@AllArgsConstructor
public class RecipientCountry {
    private String countryCode;
    private String currency;
    private String group;
    private String bankAccountFormat;
    private boolean payeeVerification;
    private Map<String, String> testAccount;
}
