package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class RequestStore {
    List<String> businessLineId; //SE3292N223226V5N5M6TSB3JK
    String city;
    String country;
    String postalCode;
    String lineAdresse1;
    String reference;
    String phoneNumber;
    String balanceAccountId; //BA3296H223229L5N5M6TCG6PF
    List<String> paymentMethodRequest; //visa //mc //cartesBancaire
}
