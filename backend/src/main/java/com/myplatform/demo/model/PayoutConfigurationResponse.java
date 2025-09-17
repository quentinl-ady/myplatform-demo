package com.myplatform.demo.model;


import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class PayoutConfigurationResponse {
    public Boolean regular;
    public Boolean instant;
    public String accountIdentifier;

    public String balanceAccountId;
    public String currencyCode;
    public String schedule; //daily weekly monthly
}
