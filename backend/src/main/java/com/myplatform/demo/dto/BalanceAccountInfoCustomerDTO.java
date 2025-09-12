package com.myplatform.demo.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BalanceAccountInfoCustomerDTO {
    private String currencyCode;
    private String description;
    private String balanceAccountId;
}
