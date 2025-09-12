package com.myplatform.demo.model;

import jakarta.persistence.Embeddable;
import lombok.Getter;
import lombok.Setter;

@Embeddable
@Getter
@Setter
public class BalanceAccountInfoCustomer {
    String currencyCode;
    String description;
    String balanceAccountId;
}
