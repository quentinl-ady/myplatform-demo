package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class RequestStore {
    List<String> businessLineId;
    String city;
    String country;
    String postalCode;
    String lineAdresse1;
    String reference;
    String phoneNumber;
    String balanceAccountId;
    List<String> paymentMethodRequest;
}
